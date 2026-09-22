import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(new URL('../worker/index.js', import.meta.url), 'utf8');
const { default: worker } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
const origin = 'https://lab.example';
const env = {
  ACCESS_PASSWORD: 'legacy-secret-used-only-for-signing',
  ASSETS: { fetch: async () => new Response('<main>App</main>') },
  DB: { prepare: () => ({ bind: () => ({ all: async () => ({ results: [] }) }) }) },
};
const get = (path, cookie) => worker.fetch(new Request(origin + path, {
  headers: cookie ? { Cookie: cookie } : {},
}), env);
const login = username => worker.fetch(new Request(origin + '/api/session', {
  method: 'POST', body: new URLSearchParams({ username }),
}), env);

test('a name alone starts a session and survives subsequent requests', async () => {
  assert.equal((await get('/')).status, 303);
  assert.equal((await get('/api/status')).status, 401);
  const response = await login('  Nguyễn Minh  ');
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, username: 'Nguyễn Minh' });
  const header = response.headers.get('set-cookie');
  assert.match(header, /HttpOnly; Secure; SameSite=Strict/);
  const cookie = header.split(';')[0];
  assert.equal((await get('/', cookie)).status, 200);
  assert.equal((await (await get('/api/status', cookie)).json()).username, 'Nguyễn Minh');
  const logout = await worker.fetch(new Request(origin + '/api/logout', {
    method: 'POST', headers: { Cookie: cookie },
  }), env);
  assert.equal(logout.status, 200);
  assert.match(logout.headers.get('set-cookie'), /Max-Age=0/);
  assert.equal((await get('/api/status', 'embedding_lab_session=')).status, 401);
  assert.equal((await (await login('Lan')).json()).username, 'Lan');
});

test('empty, oversized and control-character names are rejected', async () => {
  for (const username of ['', '   ', 'a'.repeat(101), 'a\u0000b']) {
    assert.equal((await login(username)).status, 400);
  }
});

test('old, altered and expired sessions return to the name entry flow', async () => {
  const response = await login('Minh');
  const cookie = response.headers.get('set-cookie').split(';')[0];
  for (const invalid of ['embedding_lab_session=old.password.cookie', cookie + 'x']) {
    assert.equal((await get('/api/status', invalid)).status, 401);
  }
  const now = Date.now;
  try {
    Date.now = () => now() + 8 * 24 * 60 * 60 * 1000;
    assert.equal((await get('/api/status', cookie)).status, 401);
  } finally { Date.now = now; }
});

test('cross-origin session creation is still rejected', async () => {
  const response = await worker.fetch(new Request(origin + '/api/session', {
    method: 'POST', headers: { Origin: 'https://other.example' },
    body: new URLSearchParams({ username: 'Minh' }),
  }), env);
  assert.equal(response.status, 403);
});

test('signed-in users cannot upload reference images or write to storage', async () => {
  const session = await login('Minh');
  const cookie = session.headers.get('set-cookie').split(';')[0];
  let storageCalls = 0;
  const storage = new Proxy({}, { get() { storageCalls++; throw new Error('Unexpected storage access'); } });
  const form = new FormData();
  form.set('artifact', 'new-artifact');
  form.set('file', new Blob([new Uint8Array([0xff, 0xd8, 0xff])], { type: 'image/jpeg' }), 'reference.jpg');
  const response = await worker.fetch(new Request(origin + '/api/references', {
    method: 'POST', headers: { Cookie: cookie }, body: form,
  }), { ...env, DB: storage, IMAGES: storage });
  assert.equal(response.status, 404);
  assert.equal(storageCalls, 0);
});

test('users cannot manage the catalog or access comparison and debug endpoints', async () => {
  const session = await login('Minh');
  const cookie = session.headers.get('set-cookie').split(';')[0];
  for (const [method, path] of [['POST', '/api/index'], ['POST', '/api/model/load'], ['POST', '/api/compare'], ['DELETE', '/api/references/1'], ['GET', '/api/references/1/image']]) {
    const response = await worker.fetch(new Request(origin + path, { method, headers: { Cookie: cookie } }), env);
    assert.equal(response.status, 404);
  }
  assert.deepEqual(await (await get('/api/status', cookie)).json(), { username: 'Minh', ready: false });
});

test('recognition uses the dev catalog and server thresholds and returns only the result', async () => {
  const session = await login('Minh');
  const cookie = session.headers.get('set-cookie').split(';')[0];
  let vector = [1, 0];
  const originalFetch = globalThis.fetch;
  const rows = [{ artifact: 'red', vector: '[1,0]', dimensions: 2 }, { artifact: 'blue', vector: '[0,1]', dimensions: 2 }];
  const catalogEnv = { ...env, OPENROUTER_API_KEY: 'test-only', DB: { prepare: () => ({ bind: signature => {
    assert.equal(signature, 'openrouter|google/gemini-embedding-2|1|1|rgb-exif-white-jpeg95-max1600-v1');
    return { all: async () => ({ results: rows }) };
  } }) } };
  globalThis.fetch = async url => Response.json(String(url).endsWith('/models')
    ? { data: [{ id: 'google/gemini-embedding-2', architecture: { input_modalities: ['image'] } }] }
    : { model: 'google/gemini-embedding-2', data: [{ embedding: vector }] });
  try {
    const query = async () => {
      const form = new FormData();
      form.set('file', new Blob([new Uint8Array([0xff, 0xd8, 0xff])]), 'capture.jpg');
      form.set('threshold', '-1'); form.set('min_margin', '0');
      return worker.fetch(new Request(origin + '/api/query', { method: 'POST', headers: { Cookie: cookie }, body: form }), catalogEnv);
    };
    assert.deepEqual(await (await query()).json(), { recognized: true, artifact: 'red' });
    vector = [1, 1];
    assert.deepEqual(await (await query()).json(), { recognized: false, artifact: null });
  } finally { globalThis.fetch = originalFetch; }
});
