import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../worker/index.js';
import { signature, vectorScope, DESCRIPTION_PROMPT } from '../worker/pipeline.js';
import { database, seed, envDefaults, imageBlob, testSignature } from './fixtures.mjs';
import { cleanup } from '../worker/limits.js';

const token = 'test-service-token-with-at-least-32-characters';
// JPEG envelope fixture only: tests exercise validation/protocol, not pixel decoding.
function canonicalJpeg(extra = 0, size = 640) {
  return new Blob([new Uint8Array([255,216,255,254,0,3,extra,
    255,192,0,17,8,size>>8,size&255,size>>8,size&255,3,1,17,0,2,17,1,3,17,1,
    255,218,0,12,3,1,0,2,17,3,17,0,63,0,1,255,217])], { type: 'image/jpeg' });
}
const form = (file = canonicalJpeg()) => { const value = new FormData(); value.set('file',file,'image.jpg'); return value; };

async function fixture(action, options = {}) {
  const db = database();
  const env = { ...envDefaults, RECOGNITION_PIPELINE: 'image-description-v1', RECOGNITION_SERVICE_TOKEN: token, DB: db, ...options };
  seed(db,2,signature(env));
  for (let i=1;i<=2;i++) db.sqlite.prepare('UPDATE artifacts SET external_object_id=? WHERE id=?').run(`stamp-${i}`,`a${i}`);
  const calls = { description: [], embedding: [], upsert: [], query: [] }, state = { top: .93, second: .6 };
  const original = globalThis.fetch;
  globalThis.fetch = async (url, settings) => {
    if (String(url).endsWith('/models')) return Response.json({ data: [{ id: env.OPENROUTER_MODEL, architecture: { input_modalities: ['image','text'] } }] });
    const body = JSON.parse(settings.body);
    if (String(url).endsWith('/chat/completions')) {
      calls.description.push(body);
      await state.onDescription?.();
      if (state.descriptionError) return new Response('',{status:502});
      return Response.json({ model: env.DESCRIPTION_MODEL || 'google/gemini-2.5-flash', choices: [{ finish_reason: state.finishReason || 'stop', message: { content: state.empty ? '' : state.description || 'A printed stamp depicting a seated girl in a light shirt with red and green background details.' } }] });
    }
    assert.ok(String(url).endsWith('/embeddings'));
    calls.embedding.push(body);
    if (state.embeddingError) return new Response('',{status:502});
    return Response.json({ model: env.OPENROUTER_MODEL, data: [{ embedding: [1,...Array(1535).fill(0)] }] });
  };
  env.VECTORIZE = {
    upsert: async vectors => { calls.upsert.push(...vectors); }, deleteByIds: async () => {},
    query: async (_, query) => {
      calls.query.push(query); assert.deepEqual(query.namespace, (await vectorScope(env)).namespace);
      return { matches: (state.missing ? [1] : [1,2]).map(i => ({ id: `v${i}`, score: i === 1 ? state.top : state.second, metadata: { artifact_id: `a${i}` } })) };
    },
  };
  env.IMAGES = { put: async () => {}, get: async () => ({ arrayBuffer: async () => imageBlob().arrayBuffer() }), delete: async () => {} };
  const api = (path, settings = {}) => worker.fetch(new Request(`http://localhost${path}`,settings),env);
  const request = (key = 'request-0001', file = canonicalJpeg(), headers = {}) => api('/api/v1/recognitions', { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Idempotency-Key': key, ...headers }, body: form(file) });
  try { await action({ db, env, calls, state, api, request }); }
  finally { globalThis.fetch = original; db.sqlite.close(); }
}

test('references and queries use the same AI prompt and one joint image+text embedding; only reference descriptions persist', async () => fixture(async ({ api,request,calls,db,env }) => {
  const added = await api('/api/admin/artifacts/a1/images',{method:'POST',body:form(imageBlob(9))});
  assert.equal(added.status,201);
  const id = (await added.json()).id;
  const row = db.sqlite.prepare('SELECT * FROM reference_images WHERE id=?').get(id);
  assert.match(row.description,/seated girl/); assert.equal(row.signature,signature(env));
  const result = await request(); assert.equal(result.status,200); assert.equal((await result.json()).external_object_id,'stamp-1');
  assert.equal(calls.description.length,2); assert.equal(calls.embedding.length,2);
  for (const input of calls.description) {
    assert.equal(input.messages[0].content,DESCRIPTION_PROMPT);
    assert.equal(input.messages[1].content.length,1); // No object name, candidate ID or expected label.
  }
  for (const input of calls.embedding) {
    assert.equal(input.dimensions,1536); assert.equal(input.input.length,1);
    assert.deepEqual(input.input[0].content.map(part=>part.type),['text','image_url']);
    assert.match(input.input[0].content[0].text,/seated girl/);
  }
  assert.equal(calls.upsert[0].namespace,(await vectorScope(env)).namespace);
  assert.equal(db.sqlite.prepare('SELECT COUNT(*) AS n FROM reference_images').get().n,3);
  assert.equal((await (await api('/api/admin/usage')).json()).api_today,4);
}));

test('retry preserves a completed description after embedding failure and reindex reuses saved vectors', async () => fixture(async ({ api,calls,state,db }) => {
  state.embeddingError = true;
  assert.equal((await api('/api/admin/artifacts/a1/images',{method:'POST',body:form(imageBlob(8))})).status,502);
  const row = db.sqlite.prepare("SELECT * FROM reference_images WHERE status='failed'").get();
  assert.ok(row.description); assert.equal(row.vector_json,null);
  state.embeddingError = false;
  assert.equal((await api(`/api/admin/images/${row.id}/retry`,{method:'POST'})).status,200);
  assert.equal(calls.description.length,1); assert.equal(calls.embedding.length,2);
  assert.equal((await api(`/api/admin/images/${row.id}/reindex`,{method:'POST'})).status,200);
  assert.equal(calls.description.length,1); assert.equal(calls.embedding.length,2);
}));

test('old pipeline vectors are excluded and require explicit reprocessing without deleting references', async () => fixture(async ({ api,calls,db,request,env }) => {
  db.sqlite.prepare('UPDATE reference_images SET signature=?,vector_json=?').run(testSignature,JSON.stringify([1,...Array(1535).fill(0)]));
  const before = await (await api('/api/admin/artifacts')).json();
  assert.ok(before.artifacts.every(row => row.ready_count===0 && row.outdated_count===1));
  assert.equal((await request()).status,409); assert.equal(calls.description.length,0);
  assert.equal((await api('/api/admin/images/ref1/reindex',{method:'POST'})).status,409);
  for (let i=1;i<=2;i++) assert.equal((await api(`/api/admin/images/ref${i}/reprocess`,{method:'POST'})).status,200);
  assert.equal(calls.description.length,2); assert.equal(calls.embedding.length,2);
  assert.equal(db.sqlite.prepare('SELECT COUNT(*) AS n FROM reference_images WHERE signature=?').get(signature(env)).n,2);
}));

test('description errors never silently switch to image-only matching', async () => fixture(async ({ state,request,calls }) => {
  for (const [index,condition] of ['descriptionError','empty','finishReason'].entries()) {
    state[condition] = condition==='finishReason' ? 'length' : true;
    const response = await request(`error-request-${index}`);
    assert.equal(response.status,502);
    assert.ok((await response.json()).error.code);
    state[condition] = false;
  }
  assert.equal(calls.embedding.length,0);
}));

test('the two-call budget is reserved atomically before describing an image', async () => fixture(async ({ request,calls,db }) => {
  const response = await request(); assert.equal(response.status,429);
  assert.equal((await response.json()).error.code,'DAILY_LIMIT_EXCEEDED');
  assert.equal(calls.description.length,0); assert.equal(calls.embedding.length,0);
  assert.equal(db.sqlite.prepare('SELECT COUNT(*) AS n FROM usage_buckets').get().n,0);
}, { DAILY_EMBEDDING_LIMIT: '1' }));

test('versioned API authenticates independently of admin and rejects malformed/unnormalized requests before model calls', async () => fixture(async ({ request,api,calls }) => {
  assert.equal((await request('request-0001',canonicalJpeg(),{Authorization:'Bearer wrong'})).status,401);
  assert.equal((await request('request-0001',canonicalJpeg(),{Origin:'https://example.com'})).status,403);
  assert.equal((await request('bad')).status,400);
  assert.equal((await request('request-0002',imageBlob())).status,400);
  assert.equal((await request('request-0003',canonicalJpeg(0,2000))).status,415);
  const forged=form(); forged.set('description','expected answer');
  const response=await api('/api/v1/recognitions',{method:'POST',headers:{Authorization:`Bearer ${token}`,'Idempotency-Key':'request-0004'},body:forged});
  assert.equal(response.status,400); assert.equal(calls.description.length,0);
  const catalog=await api('/api/v1/catalog',{headers:{Authorization:`Bearer ${token}`}});
  assert.equal(catalog.status,200); assert.equal((await catalog.json()).ready,true);
}));

test('idempotency replays a result after lost response, rejects changed images, and supports status lookup', async () => fixture(async ({ request,api,calls,db,env }) => {
  const original = await (await request()).json();
  const replay = await request(); assert.equal(replay.headers.get('X-Idempotent-Replay'),'true');
  assert.deepEqual(await replay.json(),original);
  assert.equal(calls.description.length,1); assert.equal(calls.embedding.length,1);
  const lookup=await api(`/api/v1/recognitions/${original.request_id}`,{headers:{Authorization:`Bearer ${token}`}});
  assert.deepEqual(await lookup.json(),original);
  const conflict=await request('request-0001',canonicalJpeg(1));
  assert.equal(conflict.status,409); assert.equal((await conflict.json()).error.code,'IDEMPOTENCY_CONFLICT');
  db.sqlite.prepare('UPDATE recognition_requests SET expires_at=0').run();
  await cleanup(env); assert.equal(db.sqlite.prepare('SELECT COUNT(*) AS n FROM recognition_requests').get().n,0);
  assert.equal(db.sqlite.prepare('SELECT COUNT(*) AS n FROM reference_images').get().n,2);
}));

test('concurrent duplicate requests cannot start a second paid pipeline', async () => fixture(async ({ request,state,calls }) => {
  let entered, release;
  const enteredPromise=new Promise(resolve=>{entered=resolve;});
  const gate=new Promise(resolve=>{release=resolve;});
  state.onDescription=async()=>{entered();await gate;};
  const first=request(); await enteredPromise;
  try {
    const second=await request(); assert.equal(second.status,409);
    assert.equal((await second.json()).error.code,'REQUEST_IN_PROGRESS');
    assert.equal(calls.description.length,1);
  } finally { release(); }
  assert.equal((await first).status,200); assert.equal(calls.embedding.length,1);
}));

test('cached provider failure remains an error on replay without another charge', async () => fixture(async ({ request,state,calls }) => {
  state.embeddingError=true;
  const first=await request(); assert.equal(first.status,502);
  const failed=await first.json(); assert.equal(failed.error.code,'PROVIDER_ERROR'); assert.equal(failed.status,undefined);
  state.embeddingError=false;
  const repeated=await request(); assert.equal(repeated.status,502); assert.deepEqual(await repeated.json(),failed);
  assert.equal(calls.description.length,1); assert.equal(calls.embedding.length,1);
}));

test('hard-negative conflict rejects only the configured targets without changing global thresholds', async () => fixture(async ({ request,db,env }) => {
  db.sqlite.prepare("UPDATE artifacts SET external_object_id='stamp-phat-ba-quan-am' WHERE id='a1'").run();
  db.sqlite.prepare(`INSERT INTO recognition_hard_negatives
    (id,target_artifact_id,signature,group_key,digest,vector)
    VALUES(?,?,?,?,?,?)`).run('hn-test','a1',signature(env),'phat-ba-quan-am-confuser-v1','a'.repeat(64),JSON.stringify([1,...Array(1535).fill(0)]));
  const response = await request('hard-negative-request-phat-ba');
  assert.equal(response.status,200);
  const result = await response.json();
  assert.equal(result.status,'uncertain');
  assert.equal(result.external_object_id,null);
  assert.equal(result.reason,'hard_negative_conflict');

  // Verify Hoàng hậu Ngọc Trúc also triggers hard_negative_conflict when confuser is present
  db.sqlite.prepare("UPDATE artifacts SET external_object_id='stamp-hoang-hau-ngoc-truc' WHERE id='a1'").run();
  db.sqlite.prepare(`INSERT INTO recognition_hard_negatives
    (id,target_artifact_id,signature,group_key,digest,vector)
    VALUES(?,?,?,?,?,?)`).run('hn-hh','a1',signature(env),'hoang-hau-ngoc-truc-confuser-v1','b'.repeat(64),JSON.stringify([1,...Array(1535).fill(0)]));
  const responseHh = await request('hard-negative-request-hoang-hau');
  assert.equal(responseHh.status,200);
  const resultHh = await responseHh.json();
  assert.equal(resultHh.status,'uncertain');
  assert.equal(resultHh.external_object_id,null);
  assert.equal(resultHh.reason,'hard_negative_conflict');
}));

test('semantic multi-scene rejection skips embedding/index and replays as uncertain rather than CATALOG_INDEXING', async () => fixture(async ({ request,state,calls,db }) => {
  state.description = 'Multiple artworks are visible in a museum setting. On the left, a portrait hangs beside a landscape. On the right, another painting hangs above a statue.';
  const response = await request('scene-guard-request');
  assert.equal(response.status,200);
  const result = await response.json();
  assert.equal(result.status,'uncertain'); assert.equal(result.external_object_id,null);
  assert.equal(result.reason,'multiple_artifacts'); assert.deepEqual(result.candidates,[]);
  assert.equal(result.semantic_guard.scene,'multi_artifact_scene');
  assert.equal(result.timings.embedding_ms,0); assert.equal(result.decision_version,'algorithm-first-v1');
  assert.equal(calls.description.length,1); assert.equal(calls.embedding.length,0); assert.equal(calls.query.length,0);
  assert.equal(db.sqlite.prepare('SELECT COUNT(*) AS n FROM reference_images').get().n,2);
  assert.deepEqual(await (await request('scene-guard-request')).json(),result);
  assert.equal(calls.description.length,1);
}));

test('explicit no-clear-artifact is a normal rejection and references do not use query-only guard', async () => fixture(async ({ request,state,calls,api }) => {
  state.description = 'No clear artifact is visible. The image consists of a blank wall.';
  assert.equal((await (await request('no-clear-request')).json()).reason,'no_clear_artifact');
  assert.equal(calls.embedding.length,0);
  assert.equal((await api('/api/admin/artifacts/a1/images',{method:'POST',body:form(imageBlob(29))})).status,201);
  assert.equal(calls.embedding.length,1);
}));

test('dominant target and internal figures are not rejected by semantic guard', async () => fixture(async ({ request,state,calls }) => {
  for (const [i,text] of [
    'A framed painting depicts three figures: two women and a child.',
    'A carved wooden door has multiple panels and several dragons in relief.',
    'Two artworks are visible. The prominent artwork is a large, multi-panel screen with leaves. A smaller painting is in the background.',
  ].entries()) {
    state.description=text;
    assert.equal((await (await request(`single-target-${i}`)).json()).status,'matched');
  }
  assert.equal(calls.embedding.length,3);
}));

test('an unrelated artifact ignores even corrupt hard-negative rows assigned to it', async () => fixture(async ({ request,db,env }) => {
  db.sqlite.prepare(`INSERT INTO recognition_hard_negatives(id,target_artifact_id,signature,group_key,digest,vector) VALUES(?,?,?,?,?,?)`)
    .run('unrelated-hn','a1',signature(env),'legacy','b'.repeat(64),'[]');
  const response=await request('unrelated-negative');
  assert.equal(response.status,200);assert.equal((await response.json()).status,'matched');
}));

test('decision statuses preserve raw score boundaries and distinguish index failure from no match', async () => fixture(async ({ request,state }) => {
  state.top=.79996;
  const below=await (await request('decision-0001')).json(); assert.equal(below.status,'no_match'); assert.equal(below.external_object_id,null);
  state.top=.9; state.second=.88;
  const close=await (await request('decision-0002')).json(); assert.equal(close.status,'uncertain'); assert.equal(close.external_object_id,null);
  state.top=.95; state.second=.5; state.missing=true;
  const missing=await request('decision-0003'); assert.equal(missing.status,503); assert.equal((await missing.json()).error.code,'CATALOG_INDEXING');
}));

test('Vectorize retries preserve the pipeline namespace and do not repeat paid description/embedding calls', async () => fixture(async ({ request,env,calls }) => {
  const originalQuery = env.VECTORIZE.query;
  let attempts = 0;
  env.VECTORIZE.query = async (vector, options) => {
    attempts++;
    assert.equal(options.namespace, (await vectorScope(env)).namespace);
    if (attempts < 3) throw new Error('VECTOR_QUERY_ERROR: Status + 500');
    return originalQuery(vector, options);
  };
  const response = await request();
  assert.equal(response.status,200);
  assert.equal((await response.json()).external_object_id,'stamp-1');
  assert.equal(attempts,3);
  assert.equal(calls.description.length,1);
  assert.equal(calls.embedding.length,1);
}));

test('persistent Vectorize errors return cached retryable 503 through the integration API', async () => fixture(async ({ request,env,calls,api }) => {
  let attempts = 0;
  env.VECTORIZE.query = async () => { attempts++; throw new Error('VECTOR_QUERY_ERROR: Status + 500'); };
  const response = await request();
  assert.equal(response.status,503);
  const failed = await response.json();
  assert.equal(failed.error.code,'VECTOR_QUERY_ERROR');
  assert.equal(failed.error.retryable,true);
  assert.match(failed.error.message,/thử lại/);
  assert.equal(attempts,4);
  const replay = await request();
  assert.equal(replay.status,503);
  assert.equal(replay.headers.get('X-Idempotent-Replay'),'true');
  assert.deepEqual(await replay.json(),failed);
  const lookup = await api(`/api/v1/recognitions/${failed.request_id}`,{headers:{Authorization:`Bearer ${token}`}});
  assert.equal(lookup.status,503);
  assert.deepEqual(await lookup.json(),failed);
  assert.equal(attempts,4);
  assert.equal(calls.description.length,1);
  assert.equal(calls.embedding.length,1);
}));

test('non-transient Vectorize failures are not retried or returned as a no-match result', async () => fixture(async ({ request,env,calls }) => {
  let attempts = 0;
  env.VECTORIZE.query = async () => { attempts++; throw new Error('VECTOR_QUERY_ERROR: Status + 400'); };
  const response = await request();
  assert.equal(response.status,503);
  const failed = await response.json();
  assert.equal(failed.error.code,'VECTOR_QUERY_ERROR');
  assert.equal(failed.status,undefined);
  assert.equal(attempts,1);
  assert.equal(calls.embedding.length,1);
}));

test('catalog changes during recognition invalidate the result rather than returning a stale external mapping', async () => fixture(async ({ request,state,db }) => {
  state.onDescription=async()=>db.sqlite.prepare("UPDATE artifacts SET external_object_id='new-id' WHERE id='a1'").run();
  const response=await request(); assert.equal(response.status,409); assert.equal((await response.json()).error.code,'CATALOG_CHANGED');
}));

test('external object IDs can be mapped through admin API and duplicate mappings are rejected', async () => fixture(async ({ api }) => {
  const patch=id=>api('/api/admin/artifacts/a1',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({external_object_id:id})});
  assert.equal((await patch('museum:em-thuy')).status,200);
  assert.equal((await patch('stamp-2')).status,409);
  assert.equal((await patch('unsafe/id')).status,400);
}));
