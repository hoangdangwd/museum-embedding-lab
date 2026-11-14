import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import worker from '../worker/index.js';
import { normalize, signature } from '../worker/pipeline.js';
import { database, seed, envDefaults, imageBlob } from './fixtures.mjs';
import { buildPayload, buildAllPayloads, HARD_NEGATIVE_BANKS } from '../scripts/seed-hard-negative.mjs';

const unit = score => [score, Math.sqrt(1 - score * score), ...Array(1534).fill(0)];

async function fixture(action) {
  const db = database();
  const env = { ...envDefaults, DB: db };
  seed(db,2,signature(env));
  db.sqlite.prepare("UPDATE artifacts SET external_object_id='stamp-phat-ba-quan-am' WHERE id='a1'").run();
  const state = { top: .9, second: .6, winner: 'a1', providerCalls: 0 };
  const original = globalThis.fetch;
  globalThis.fetch = async url => {
    if (String(url).endsWith('/models')) return Response.json({ data: [{ id: env.OPENROUTER_MODEL, architecture: { input_modalities: ['image'] } }] });
    state.providerCalls++;
    return Response.json({ model: env.OPENROUTER_MODEL, data: [{ embedding: [1,...Array(1535).fill(0)] }] });
  };
  env.VECTORIZE = { query: async () => ({ matches: [1,2].map(i => ({ id: `v${i}`, score: state.winner === `a${i}` ? state.top : state.second, metadata: { artifact_id: `a${i}` } })) }) };
  const api = (path,settings={}) => worker.fetch(new Request(`http://localhost${path}`,settings),env);
  const install = (vectors=[{id:'hn-test',digest:'a'.repeat(64),vector:unit(.95)}], extra={}) => api('/api/admin/hard-negatives/phat-ba-quan-am-confuser-v1',{
    method:'PUT',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({target_external_object_id:'stamp-phat-ba-quan-am',signature:signature(env),vectors,...extra}),
  });
  const query = async () => {
    const form=new FormData();form.set('file',imageBlob(),'query.jpg');
    return api('/api/admin/query',{method:'POST',body:form});
  };
  try { await action({db,env,state,api,install,query}); }
  finally { globalThis.fetch=original;db.sqlite.close(); }
}

test('hard-negative install is atomic, signature-checked, normalized, and never enters the artifact/reference catalog',async()=>fixture(async({db,env,install,api,state})=>{
  const before=db.sqlite.prepare('SELECT revision FROM catalog_state').get().revision;
  assert.equal((await install()).status,200);
  assert.equal(db.sqlite.prepare('SELECT revision FROM catalog_state').get().revision,before+1);
  assert.equal(db.sqlite.prepare('SELECT COUNT(*) AS n FROM artifacts').get().n,2);
  assert.equal(db.sqlite.prepare('SELECT COUNT(*) AS n FROM reference_images').get().n,2);
  const row=db.sqlite.prepare('SELECT * FROM recognition_hard_negatives').get();
  assert.equal(row.target_artifact_id,'a1');assert.equal(row.signature,signature(env));
  assert.ok(Math.abs(Math.hypot(...JSON.parse(row.vector))-1)<1e-12);
  assert.equal((await install()).status,200);
  assert.equal(db.sqlite.prepare('SELECT COUNT(*) AS n FROM recognition_hard_negatives').get().n,1);
  assert.equal((await install(undefined,{signature:'wrong'})).status,409);
  assert.equal((await install([{id:'bad',digest:'a'.repeat(64),vector:[1,2]}])).status,400);
  assert.equal((await install([])).status,400);
  assert.equal((await install(undefined,{target_external_object_id:'not-present'})).status,404);
  assert.equal(db.sqlite.prepare('SELECT COUNT(*) AS n FROM recognition_hard_negatives').get().n,1);
  assert.equal((await (await api('/api/admin/hard-negatives')).json()).hard_negatives[0].vector_count,1);
  assert.equal(state.providerCalls,0);
}));

test('hard-negative veto rejects the confusing statue, preserves stronger true matches and never switches to runner-up',async()=>fixture(async({install,query,state})=>{
  await install();
  let result=await (await query()).json();
  assert.equal(result.hard_negative_triggered,true);assert.equal(result.status,'uncertain');
  assert.equal(result.recognized,false);assert.equal(result.artifact_id,null);
  assert.equal(result.threshold,.8);assert.equal(result.margin,.05);
  assert.equal(result.candidates[0].id,'a1');assert.equal(result.hard_negative_score,.95);
  state.top=.98;
  result=await (await query()).json();
  assert.equal(result.recognized,true);assert.equal(result.artifact_id,'a1');
  state.top=.9;state.winner='a2';
  result=await (await query()).json();
  assert.equal(result.recognized,true);assert.equal(result.artifact_id,'a2');assert.equal(result.hard_negative_score,null);
  assert.equal(state.providerCalls,3); // One existing image-only pipeline per query, no extra provider calls for the guard.
}));

test('disabled or old-pipeline negatives do not veto; corrupt current vectors fail closed',async()=>fixture(async({db,install,query,env})=>{
  await install();
  db.sqlite.prepare('UPDATE recognition_hard_negatives SET enabled=0').run();
  assert.equal((await (await query()).json()).recognized,true);
  db.sqlite.prepare("UPDATE recognition_hard_negatives SET enabled=1,signature='old'").run();
  assert.equal((await (await query()).json()).recognized,true);
  db.sqlite.prepare('UPDATE recognition_hard_negatives SET signature=?,vector=?').run(signature(env),'[]');
  assert.equal((await query()).status,503);
}));

test('hard-negative comparison uses unrounded scores at the zero-gap boundary',async()=>fixture(async({install,query,state})=>{
  const exact=normalize(unit(.9))[0];await install([{id:'hn-boundary',digest:'b'.repeat(64),vector:unit(.9)}]);
  state.top=exact-1e-7;
  assert.equal((await (await query()).json()).hard_negative_triggered,true);
  state.top=exact+1e-7;
  assert.equal((await (await query()).json()).recognized,true);
}));

test('hard-negative installation refuses unsupported artifacts and unrelated bank rows never veto',async()=>fixture(async({api,db,env,install,query,state})=>{
  db.sqlite.prepare("UPDATE artifacts SET external_object_id='stamp-em-thuy' WHERE id='a2'").run();
  const response=await install(undefined,{target_external_object_id:'stamp-em-thuy'});
  assert.equal(response.status,400);
  db.sqlite.prepare(`INSERT INTO recognition_hard_negatives(id,target_artifact_id,signature,group_key,digest,vector) VALUES(?,?,?,?,?,?)`)
    .run('legacy-other','a2',signature(env),'legacy','b'.repeat(64),'[]');
  state.winner='a2';
  const result=await (await query()).json();
  assert.equal(result.recognized,true);assert.equal(result.hard_negative_score,null);
  assert.equal('geometry' in result,false);assert.equal('family' in result,false);
}));

test('Hoàng hậu Ngọc Trúc hard-negative bank installs and vetoes confusers independently',async()=>fixture(async({api,db,env,query,state})=>{
  db.sqlite.prepare("UPDATE artifacts SET external_object_id='stamp-hoang-hau-ngoc-truc' WHERE id='a2'").run();
  const installHoangHau = (vectors=[{id:'hn-hh-1',digest:'d'.repeat(64),vector:unit(.95)}]) => api('/api/admin/hard-negatives/hoang-hau-ngoc-truc-confuser-v1',{
    method:'PUT',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({target_external_object_id:'stamp-hoang-hau-ngoc-truc',signature:signature(env),vectors}),
  });
  const res = await installHoangHau();
  assert.equal(res.status,200);
  const data = await res.json();
  assert.equal(data.group_key,'hoang-hau-ngoc-truc-confuser-v1');
  assert.equal(data.target_external_object_id,'stamp-hoang-hau-ngoc-truc');
  assert.equal(data.vector_count,1);

  state.winner = 'a2';
  state.top = .9;
  let result = await (await query()).json();
  assert.equal(result.recognized,false);
  assert.equal(result.hard_negative_triggered,true);
  assert.equal(result.status,'uncertain');
  assert.equal(result.reason,'hard_negative_conflict');
  assert.equal(result.hard_negative_score,.95);

  state.top = .98;
  result = await (await query()).json();
  assert.equal(result.recognized,true);
  assert.equal(result.hard_negative_triggered,false);
  assert.equal(result.artifact_id,'a2');
}));

test('production config pins the approved negative gap without changing other settings or dev',async()=>{
  const config=JSON.parse((await readFile(new URL('../wrangler.jsonc',import.meta.url),'utf8')).replace(/,\s*([}\]])/g,'$1'));
  assert.equal(config.vars.RECOGNITION_HARD_NEGATIVE_GAP,'-0.009');
  assert.equal(config.vars.RECOGNITION_THRESHOLD,'0.8');
  assert.equal(config.vars.RECOGNITION_MARGIN,'0.05');
  assert.equal('RECOGNITION_GEOMETRY_MODE' in config.vars,false);
  assert.equal(config.vars.DAILY_EMBEDDING_LIMIT,'100000');
  assert.equal(config.env.dev.vars.RECOGNITION_HARD_NEGATIVE_GAP,'-0.08');
});

test('approved production gap uses unrounded scores on both sides of -0.009',async()=>fixture(async({env,install,query,state})=>{
  env.RECOGNITION_HARD_NEGATIVE_GAP='-0.009';
  await install([{id:'hn-production-boundary',digest:'c'.repeat(64),vector:unit(.9)}]);
  const boundary=normalize(unit(.9))[0]-.009;
  state.top=boundary-1e-7;
  let result=await (await query()).json();
  assert.equal(result.best_score,.891);assert.equal(result.hard_negative_gap,-.009);
  assert.equal(result.recognized,false);assert.equal(result.reason,'hard_negative_conflict');
  state.top=boundary+1e-7;
  result=await (await query()).json();
  assert.equal(result.best_score,.891);assert.equal(result.hard_negative_gap,-.009);
  assert.equal(result.recognized,true);assert.equal(result.hard_negative_triggered,false);
}));

test('approved production gap scans all seven negatives, blocks confusers and preserves small true-match deficits',async()=>fixture(async({env,install,query,state})=>{
  env.RECOGNITION_HARD_NEGATIVE_GAP='-0.009';
  for(const sample of [
    {positive:.8344588205782253,negative:.9055076844165854,accepted:false},
    {positive:.8820574285595163,negative:.8894035405534713,accepted:true},
  ]){
    await install(Array.from({length:7},(_,i)=>({id:`hn-seven-${i}`,digest:String(i+1).repeat(64),vector:unit(i===6?sample.negative:.2)})));
    state.top=sample.positive;
    const result=await (await query()).json();
    assert.equal(result.recognized,sample.accepted);
    assert.equal(result.hard_negative_triggered,!sample.accepted);
    assert.equal(result.hard_negative_score,Number(sample.negative.toFixed(4)));
    assert.equal(result.threshold,.8);assert.equal(result.margin,.05);
    assert.equal(result.candidates[0].id,'a1');
  }
}));

test('new guard endpoints require the same admin authorization as catalog editing',async()=>fixture(async({api,env})=>{
  env.ALLOW_ADMIN_LOCAL='false';
  assert.equal((await api('/api/admin/hard-negatives')).status,403);
  assert.equal((await api('/api/admin/hard-negatives/test',{method:'PUT',body:'{}'})).status,403);
}));

test('buildPayload correctly parses calibration manifest and cache for both guard banks', async () => {
  const manifestPath = resolve('data/evaluation/full-calibration-manifest.json');
  const cachePath = resolve('data/evaluation/full-calibration-embeddings.json');

  const phatBa = await buildPayload(manifestPath, cachePath, 'stamp-phat-ba-quan-am');
  assert.equal(phatBa.target_external_object_id, 'stamp-phat-ba-quan-am');
  assert.equal(phatBa.group_key, 'phat-ba-quan-am-confuser-v1');
  assert.equal(phatBa.vectors.length, 7);

  const hoangHau = await buildPayload(manifestPath, cachePath, 'stamp-hoang-hau-ngoc-truc');
  assert.equal(hoangHau.target_external_object_id, 'stamp-hoang-hau-ngoc-truc');
  assert.equal(hoangHau.group_key, 'hoang-hau-ngoc-truc-confuser-v1');
  assert.equal(hoangHau.vectors.length, 7);

  const all = await buildAllPayloads(manifestPath, cachePath);
  assert.equal(all.length, 2);
  assert.deepEqual(all.map(p => p.group_key), ['phat-ba-quan-am-confuser-v1', 'hoang-hau-ngoc-truc-confuser-v1']);
});
