import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../worker/index.js';
import { database, seed, envDefaults, imageBlob } from './fixtures.mjs';
import { reserve, reserveEmbedding, cleanup, usageStats } from '../worker/limits.js';

async function fixture(action) {
  const db = database(); seed(db, 2);
  let calls = 0, upserts = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async url => String(url).endsWith('/models') ? Response.json({ data: [{ id: envDefaults.OPENROUTER_MODEL, architecture: { input_modalities: ['image'] } }] })
    : (calls++, Response.json({ model: envDefaults.OPENROUTER_MODEL, data: [{ embedding: [1, ...Array(1535).fill(0)] }] }));
  const env = { ...envDefaults, DB: db, VECTORIZE: { query: async () => ({ matches: [
    { id: 'v1', score: .95, metadata: { artifact_id: 'a1' } }, { id: 'v2', score: .5, metadata: { artifact_id: 'a2' } },
  ] }), upsert: async () => { upserts++; }, deleteByIds: async () => {} }, IMAGES: { put: async () => {}, delete: async () => {}, get: async () => ({ arrayBuffer: async () => imageBlob().arrayBuffer() }) }, ASSETS: { fetch: async () => new Response('simple app') } };
  const api = (path, options = {}) => worker.fetch(new Request('http://localhost' + path, options), env);
  try { await action({ db, env, api, calls: () => calls, upserts: () => upserts }); }
  finally { globalThis.fetch = originalFetch; db.sqlite.close(); }
}

test('simple catalog is independent of missions and root/legacy routes require admin access', async () => fixture(async ({ api, env }) => {
  const response = await api('/api/admin/artifacts'); assert.equal(response.status, 200);
  assert.ok((await response.json()).artifacts.every(artifact => !('mission' in artifact)));
  assert.equal((await api('/')).status, 200);
  for (const path of ['/', '/index.html', '/admin', '/admin/test/met']) {
    assert.equal((await worker.fetch(new Request('http://localhost' + path), { ...env, ALLOW_ADMIN_LOCAL: 'false' })).status, 403);
  }
  const redirect = await api('/admin/test/met'); assert.equal(redirect.status, 302); assert.equal(redirect.headers.get('location'), '/');
}));

test('removed gameplay, mission and lab endpoints do not execute or spend API calls', async () => fixture(async ({ api, calls }) => {
  for (const path of ['/api/game', '/api/game/session', '/api/game/scan', '/api/met-lab/catalog', '/api/met-lab/upload', '/api/admin/artifacts/a1/mission']) {
    assert.equal((await api(path, { method: 'POST' })).status, 410, path);
  }
  assert.equal(calls(), 0);
}));

test('reference import, duplicate rejection, query and saved-vector reindex use existing APIs', async () => fixture(async ({ api, calls, upserts, db }) => {
  const form = new FormData(); form.set('file', imageBlob(8), 'reference.jpg');
  const imported = await api('/api/admin/artifacts/a1/images', { method: 'POST', body: form }); assert.equal(imported.status, 201);
  const image = await imported.json(); assert.equal(image.status, 'ready'); assert.equal(calls(), 1);
  const duplicate = await api('/api/admin/artifacts/a1/images', { method: 'POST', body: form }); assert.equal(duplicate.status, 409); assert.equal(calls(), 1);
  const reindex = await api(`/api/admin/images/${image.id}/reindex`, { method: 'POST' }); assert.equal(reindex.status, 200); assert.equal(calls(), 1); assert.equal(upserts(), 2);
  const query = new FormData(); query.set('file', imageBlob(9), 'query.jpg');
  const result = await api('/api/admin/query', { method: 'POST', body: query }); assert.equal(result.status, 200); assert.equal((await result.json()).recognized, true); assert.equal(calls(), 2);
  assert.equal(db.sqlite.prepare('SELECT COUNT(*) AS count FROM reference_images').get().count, 3);
  const usage = await (await api('/api/admin/usage')).json(); assert.equal(usage.api_today, 2); assert.equal('scans' in usage, false);
}));

test('daily limit rejects a paid call atomically and expired counters are cleaned without deleting references', async () => fixture(async ({ env, api, db, calls }) => {
  env.DAILY_EMBEDDING_LIMIT = '1'; await reserveEmbedding(env);
  const form = new FormData(); form.set('file', imageBlob(4), 'query.jpg');
  const response = await api('/api/admin/query', { method: 'POST', body: form }); assert.equal(response.status, 429); assert.equal(calls(), 0);
  assert.match((await response.json()).detail, /danh mục và ảnh tham chiếu/);
  const counts = await Promise.all(Array.from({ length: 10 }, () => reserve(env, 'parallel', 3, Math.floor(Date.now()/1000) + 100)));
  assert.equal(counts.filter(Boolean).length, 3);
  db.sqlite.prepare('INSERT INTO usage_buckets(key,used,expires_at) VALUES(?,?,?)').run('expired', 1, 0);
  await cleanup(env); assert.equal(db.sqlite.prepare("SELECT key FROM usage_buckets WHERE key='expired'").get(), undefined);
  assert.equal(db.sqlite.prepare('SELECT COUNT(*) AS count FROM reference_images').get().count, 2);
  assert.equal((await (await usageStats(env)).json()).daily_limit, 1);
}));
