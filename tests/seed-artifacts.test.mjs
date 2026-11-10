import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import worker from '../worker/index.js';
import { DESCRIPTION_PROMPT, DESCRIPTION_VERSION } from '../worker/pipeline.js';
import { database, envDefaults, imageBlob } from './fixtures.mjs';
import { seedStamps } from '../scripts/seed-stamps.mjs';
import { seedArtifacts } from '../scripts/seed-artifacts.mjs';

const catalog = JSON.parse(readFileSync(new URL('../data/artifacts.json', import.meta.url), 'utf8'));
const oldCatalog = JSON.parse(readFileSync(new URL('../data/Stamp/catalog.json', import.meta.url), 'utf8'));
const quiet = { apply: true, log: () => {} };
const hash = bytes => createHash('sha256').update(bytes).digest('hex');

test('artifact catalog maps all local reference photos to nine artworks; Bình phong and Gióng are present', () => {
  assert.equal(catalog.length, 9);
  assert.deepEqual(catalog.map(item => item.id).sort(), oldCatalog.map(item => item.id).sort());
  const files = catalog.flatMap(item => item.files);
  assert.equal(new Set(files).size, 45);
  const actual = readdirSync(new URL('../data/references/', import.meta.url), { recursive: true }).filter(file => file.endsWith('.jpg')).map(file => `references/${file.replaceAll('\\', '/')}`);
  assert.deepEqual(files.sort(), actual.sort());
  assert.ok(files.every(file => existsSync(new URL(`../data/${file}`, import.meta.url))));
  assert.equal(catalog.find(item => item.id === 'stamp-binh-phong').files.length, 10);
  assert.equal(catalog.find(item => item.id === 'stamp-giong').files.length, 4);
  assert.deepEqual(catalog.filter(item => !item.files.length), []);
  assert.equal(DESCRIPTION_VERSION, 'artifact-visible-en-v1');
  assert.match(DESCRIPTION_PROMPT, /artwork or museum artifact/);
  assert.doesNotMatch(DESCRIPTION_PROMPT, /Describe only the visible printed stamp/);
});

async function fixture(action, { legacy = true } = {}) {
  const db = database(), storage = new Map(), deleted = [], vectorsDeleted = [];
  let descriptions = 0, embeddings = 0, fail = false;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async url => {
    if (String(url).endsWith('/models')) return Response.json({ data: [{ id: envDefaults.OPENROUTER_MODEL, architecture: { input_modalities: ['image', 'text'] } }] });
    if (String(url).endsWith('/chat/completions')) {
      descriptions++;
      return Response.json({ model: 'google/gemini-2.5-flash', choices: [{ finish_reason: 'stop', message: { content: 'An artwork with distinct shapes and colours.' } }] });
    }
    embeddings++;
    return fail ? new Response('', { status: 502 }) : Response.json({ model: envDefaults.OPENROUTER_MODEL, data: [{ embedding: [1, ...Array(1535).fill(0)] }] });
  };
  const env = { ...envDefaults, RECOGNITION_PIPELINE: 'image-description-v1', DB: db,
    IMAGES: {
      put: async (key, bytes) => storage.set(key, bytes),
      get: async key => storage.has(key) ? { body: storage.get(key), arrayBuffer: async () => storage.get(key) } : null,
      delete: async key => { deleted.push(key); storage.delete(key); },
    },
    VECTORIZE: { upsert: async () => {}, deleteByIds: async ids => vectorsDeleted.push(...ids) },
  };
  const api = async (path, options = {}, binary = false) => {
    const response = await worker.fetch(new Request('http://localhost' + path, options), env);
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${(await response.json()).detail}`);
    return binary ? Buffer.from(await response.arrayBuffer()) : response.json();
  };
  const sources = await Promise.all(oldCatalog.map(async (item, index) => ({ ...item, filename: `${item.id}-v5.jpg`, bytes: Buffer.from(await imageBlob(index).arrayBuffer()) })));
  let index = 30;
  const entries = await Promise.all(catalog.map(async item => ({ ...item, legacyHashes: [hash(sources.find(source => source.id === item.id).bytes)],
    references: await Promise.all(item.files.map(async file => ({ id: item.id, name: item.name, filename: file, bytes: Buffer.from(await imageBlob(index++).arrayBuffer()) }))),
  })));
  try {
    if (legacy) await seedStamps(api, sources, quiet);
    await action({ db, api, entries, sources, deleted, vectorsDeleted, storage, counts: () => ({ descriptions, embeddings }), setFail: value => { fail = value; } });
  } finally { globalThis.fetch = originalFetch; db.sqlite.close(); }
}

test('dry run does not write/delete or call providers', async () => fixture(async ({ db, api, entries, deleted, counts }) => {
  const before = counts();
  const rows = db.sqlite.prepare('SELECT * FROM reference_images').all();
  const results = await seedArtifacts(api, entries, { log: () => {} });
  assert.ok(results.every(result => !result.applied));
  assert.equal(results.flatMap(result => result.removed).length, 9);
  assert.deepEqual(db.sqlite.prepare('SELECT * FROM reference_images').all(), rows);
  assert.deepEqual(counts(), before);
  assert.deepEqual(deleted, []);
}));

test('replacement removes all legacy stamp JPEGs/vectors, keeps artifact IDs/custom photos, and is idempotent', async () => fixture(async ({ db, api, entries, sources, deleted, vectorsDeleted, counts }) => {
  const artifactIds = db.sqlite.prepare('SELECT id FROM artifacts ORDER BY id').all();
  // Byte matching removes legacy images even after a manual filename change.
  db.sqlite.prepare("UPDATE reference_images SET filename='manual.jpg'").run();
  await seedStamps(api, [{ ...sources[0], filename: 'custom-photo.jpg', bytes: Buffer.from(await imageBlob(99).arrayBuffer()) }], quiet);
  const before = counts();
  const results = await seedArtifacts(api, entries, quiet);
  assert.equal(results.filter(result => result.action === 'error').length, 0);
  assert.equal(results.flatMap(result => result.removed).length, 9);
  assert.equal(deleted.length, 9);
  assert.equal(vectorsDeleted.length, 9);
  assert.equal(db.sqlite.prepare('SELECT COUNT(*) AS n FROM reference_images').get().n, 46);
  assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS n FROM reference_images WHERE filename='custom-photo.jpg'").get().n, 1);
  assert.deepEqual(db.sqlite.prepare('SELECT id FROM artifacts ORDER BY id').all(), artifactIds);
  assert.deepEqual(counts(), { descriptions: before.descriptions + 45, embeddings: before.embeddings + 45 });
  const again = await seedArtifacts(api, entries, quiet);
  assert.ok(again.every(result => !result.removed.length && result.imports.every(item => item.action === 'skip')));
  assert.deepEqual(counts(), { descriptions: before.descriptions + 45, embeddings: before.embeddings + 45 });
}));

test('fresh database gets nine artifacts and all local reference photos, including Gióng', async () => fixture(async ({ db, api, entries, counts }) => {
  const result = await seedArtifacts(api, entries, quiet);
  assert.equal(result.filter(item => item.action === 'missing').length, 0);
  assert.equal(result.filter(item => item.action === 'error').length, 0);
  assert.equal(db.sqlite.prepare('SELECT COUNT(*) AS n FROM artifacts').get().n, 9);
  assert.equal(db.sqlite.prepare('SELECT COUNT(*) AS n FROM reference_images').get().n, 45);
  assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS n FROM reference_images i JOIN artifacts a ON a.id=i.artifact_id WHERE a.external_object_id='stamp-giong'").get().n, 4);
  assert.deepEqual(counts(), { descriptions: 45, embeddings: 45 });
}, { legacy: false }));

test('failed replacement retains old stamp; explicit retry reuses description and deletes stamp only when ready', async () => fixture(async ({ db, api, entries, deleted, counts, setFail }) => {
  setFail(true);
  const failed = await seedArtifacts(api, entries.slice(0, 1), quiet);
  assert.equal(failed[0].action, 'error');
  assert.equal(deleted.length, 0);
  const before = counts();
  setFail(false);
  const retry = await seedArtifacts(api, entries.slice(0, 1), quiet);
  assert.equal(retry[0].action, 'ready');
  assert.equal(retry[0].imports[0].action, 'retry');
  assert.equal(deleted.length, 1);
  assert.deepEqual(counts(), { descriptions: before.descriptions, embeddings: before.embeddings + 3 });
  assert.equal(db.sqlite.prepare('SELECT COUNT(*) AS n FROM reference_images').get().n, 11);
}));

test('both Bình phong views must be ready before its stamp is removed', async () => fixture(async ({ api, entries, deleted }) => {
  const entry = entries.find(item => item.id === 'stamp-binh-phong');
  const interrupted = async (path, options, binary) => {
    if (options?.method === 'POST' && options.body instanceof FormData && options.body.get('file').name === entry.references[1].filename) throw new Error('interrupted');
    return api(path, options, binary);
  };
  const result = await seedArtifacts(interrupted, [entry], quiet);
  assert.equal(result[0].action, 'error');
  assert.equal(deleted.length, 0);
  const retry = await seedArtifacts(api, [entry], quiet);
  assert.equal(retry[0].action, 'ready');
  assert.equal(deleted.length, 1);
}));
