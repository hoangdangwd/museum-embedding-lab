import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import worker from '../worker/index.js';
import { database, envDefaults, imageBlob } from './fixtures.mjs';
import { seedStamps, adminClient } from '../scripts/seed-stamps.mjs';

const catalog = JSON.parse(readFileSync(new URL('../data/Stamp/catalog.json', import.meta.url), 'utf8'));
const quiet = { apply: true, log: () => {} };

test('bundled catalog contains exactly the nine source stamps with unique stable IDs and names', () => {
  assert.equal(catalog.length, 9);
  assert.equal(new Set(catalog.map(item => item.id)).size, 9);
  assert.equal(new Set(catalog.map(item => item.name)).size, 9);
  assert.deepEqual(catalog.map(item => item.file).sort(), readdirSync(new URL('../data/Stamp/', import.meta.url)).filter(file => file.endsWith('.webp')).sort());
  for (const item of catalog) assert.match(item.id, /^stamp-[a-z-]+$/);
});

async function fixture(action) {
  const db = database(), storage = new Map();
  const counts = { descriptions: 0, embeddings: 0, upserts: 0 };
  let fail = false;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async url => {
    if (String(url).endsWith('/models')) return Response.json({ data: [{ id: envDefaults.OPENROUTER_MODEL, architecture: { input_modalities: ['image', 'text'] } }] });
    if (String(url).endsWith('/chat/completions')) {
      counts.descriptions++;
      return Response.json({ model: 'google/gemini-2.5-flash', choices: [{ finish_reason: 'stop', message: { content: 'A printed stamp with a distinct central illustration.' } }] });
    }
    counts.embeddings++;
    return fail ? new Response('', { status: 502 }) : Response.json({ model: envDefaults.OPENROUTER_MODEL, data: [{ embedding: [1, ...Array(1535).fill(0)] }] });
  };
  const env = { ...envDefaults, RECOGNITION_PIPELINE: 'image-description-v1', DB: db,
    IMAGES: {
      put: async (key, bytes, metadata) => storage.set(key, { bytes, ...metadata }),
      get: async key => { const item = storage.get(key); return item && { body: item.bytes, arrayBuffer: async () => item.bytes, httpMetadata: item.httpMetadata }; },
    },
    VECTORIZE: { upsert: async () => { counts.upserts++; }, deleteByIds: async () => {} },
  };
  const api = async (path, options = {}, binary = false) => {
    const response = await worker.fetch(new Request('http://localhost' + path, options), env);
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${(await response.json()).detail}`);
    return binary ? Buffer.from(await response.arrayBuffer()) : response.json();
  };
  const stamps = await Promise.all(catalog.map(async (stamp, i) => ({ ...stamp, filename: `${stamp.id}-v5.jpg`, bytes: Buffer.from(await imageBlob(i).arrayBuffer()) })));
  try { await action({ db, env, counts, api, stamps, setFail: value => { fail = value; } }); }
  finally { globalThis.fetch = originalFetch; db.sqlite.close(); }
}

test('dry run is read-only; seed imports nine actual references; second run spends nothing', async () => fixture(async ({ db, api, stamps, counts }) => {
  const planned = await seedStamps(api, stamps, { log: () => {} });
  assert.ok(planned.every(item => item.action === 'import' && !item.applied));
  assert.equal(db.sqlite.prepare('SELECT COUNT(*) AS n FROM artifacts').get().n, 0);
  assert.equal(counts.embeddings, 0);
  const imported = await seedStamps(api, stamps, quiet);
  assert.ok(imported.every(item => item.applied));
  assert.deepEqual(counts, { descriptions: 9, embeddings: 9, upserts: 9 });
  const rows = db.sqlite.prepare('SELECT * FROM reference_images').all();
  assert.equal(rows.length, 9);
  assert.ok(rows.every(row => row.status === 'ready' && row.description && JSON.parse(row.vector_json).length === 1536));
  assert.equal(new Set(db.sqlite.prepare('SELECT external_object_id FROM artifacts').all().map(row => row.external_object_id)).size, 9);
  const skipped = await seedStamps(api, stamps, quiet);
  assert.ok(skipped.every(item => item.action === 'skip'));
  assert.deepEqual(counts, { descriptions: 9, embeddings: 9, upserts: 9 });
}));

test('earlier imports with another filename/name casing are reused without changing external mappings', async () => fixture(async ({ db, api, stamps, counts }) => {
  await seedStamps(api, stamps.slice(0, 1), quiet);
  db.sqlite.prepare('UPDATE artifacts SET name=?,external_object_id=?').run(` ${stamps[0].name.toUpperCase()} `, 'main-project-id');
  db.sqlite.prepare('UPDATE reference_images SET filename=?').run('manual-upload.jpg');
  const result = await seedStamps(api, stamps.slice(0, 1), quiet);
  assert.equal(result[0].action, 'skip');
  assert.equal(counts.embeddings, 1);
  assert.equal(db.sqlite.prepare('SELECT external_object_id FROM artifacts').get().external_object_id, 'main-project-id');
}));

test('failed embedding is retried on an explicit rerun with the cached description and no duplicate', async () => fixture(async ({ db, api, stamps, counts, setFail }) => {
  setFail(true);
  const failed = await seedStamps(api, stamps.slice(0, 1), quiet);
  assert.equal(failed[0].action, 'error');
  assert.equal(db.sqlite.prepare('SELECT status FROM reference_images').get().status, 'failed');
  setFail(false);
  const retry = await seedStamps(api, stamps.slice(0, 1), quiet);
  assert.equal(retry[0].action, 'retry');
  assert.deepEqual(counts, { descriptions: 1, embeddings: 2, upserts: 1 });
  assert.equal(db.sqlite.prepare('SELECT COUNT(*) AS n FROM reference_images').get().n, 1);
}));

test('outdated references are reprocessed; pending work is not submitted again', async () => fixture(async ({ db, api, stamps, counts }) => {
  await seedStamps(api, stamps.slice(0, 1), quiet);
  db.sqlite.prepare("UPDATE reference_images SET signature='old', description_signature='old'").run();
  const reprocessed = await seedStamps(api, stamps.slice(0, 1), quiet);
  assert.equal(reprocessed[0].action, 'reprocess');
  assert.equal(counts.descriptions, 2);
  db.sqlite.prepare("UPDATE reference_images SET status='pending'").run();
  const pending = await seedStamps(api, stamps.slice(0, 1), quiet);
  assert.equal(pending[0].action, 'error');
  assert.match(pending[0].error, /pending/);
  assert.equal(counts.embeddings, 2);
}));

test('seed client does not send Access credentials over plaintext remote connections', () => {
  assert.throws(() => adminClient('http://example.com'), /HTTPS/);
  assert.throws(() => adminClient('https://user:password@example.com'), /credentials/);
  assert.doesNotThrow(() => adminClient('http://localhost:5173'));
});
