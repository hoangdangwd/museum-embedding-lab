// Offline actual-Worker replay. Uses read-only production vector snapshots and
// cached calibration descriptions/vectors. Never reads/scores final images.
import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { database } from '../tests/fixtures.mjs';
import { recognize } from '../worker/index.js';
import { normalize, signature } from '../worker/pipeline.js';
import { HARD_NEGATIVE_TARGET } from '../worker/recognition-policy.js';

const root = resolve(import.meta.dirname, '..');
const load = async path => JSON.parse(await readFile(resolve(root,path),'utf8'));
const [referencePath = 'reports/hard-negative-veto-v1/production-reference-vectors.json', negativePath = 'reports/hard-negative-veto-v1/production-hard-negative-vectors.json', out = 'reports/algorithm-first-v1'] = process.argv.slice(2);
const manifest = await load('data/evaluation/full-calibration-manifest.json');
const cache = await load('data/evaluation/full-calibration-embeddings.json');
const refs = (await load(referencePath))[0].results.map(row => ({ ...row, vector:normalize(JSON.parse(row.vector_json)) }));
const hard = (await load(negativePath))[0].results.map(row=>({...row,normalized:normalize(JSON.parse(row.vector))}));
assert.equal(refs.length,10,'Replay must use the 10-reference production snapshot, not the 45-reference research catalog');
const db = database();
for (const r of refs) {
  db.sqlite.prepare('INSERT OR IGNORE INTO artifacts(id,name,name_key,external_object_id) VALUES(?,?,?,?)').run(r.id,r.name,r.id,r.external_object_id);
  db.sqlite.prepare("INSERT INTO reference_images(id,artifact_id,filename,digest,r2_key,vector_id,status,signature) VALUES(?,?,?,?,?,?,'ready',?)").run(r.vector_id,r.id,r.vector_id,r.vector_id,r.vector_id,r.vector_id,r.signature);
}
for (const h of hard) db.sqlite.prepare('INSERT INTO recognition_hard_negatives(id,target_artifact_id,signature,group_key,digest,vector,enabled) VALUES(?,?,?,?,?,?,?)').run(h.id,h.target_artifact_id,h.signature,h.group_key,h.digest,h.vector,h.enabled);
const env = { DB:db, RECOGNITION_PIPELINE:manifest.pipeline.mode, OPENROUTER_MODEL:manifest.model, DESCRIPTION_MODEL:manifest.pipeline.description_model,
  EMBEDDING_VERSION:manifest.pipeline.embedding_version, PREPROCESS_VERSION:manifest.pipeline.preprocess_version, EMBEDDING_DIMENSIONS:'1536',
  OPENROUTER_API_KEY:'offline-placeholder', DAILY_EMBEDDING_LIMIT:'100000', RECOGNITION_THRESHOLD:'0.8', RECOGNITION_MARGIN:'0.05', RECOGNITION_HARD_NEGATIVE_GAP:'-0.08', RECOGNITION_GEOMETRY_MODE:'off' };
assert.equal(signature(env),manifest.signature);assert.ok(refs.every(r=>r.signature===manifest.signature));
const dot = (a,b)=>a.reduce((s,v,i)=>s+v*b[i],0);
let query, descriptionCalls=0, embeddingCalls=0, indexCalls=0;
const nativeFetch = globalThis.fetch;
globalThis.fetch = async url => {
  if (String(url).endsWith('/embeddings/models')) return Response.json({data:[{id:manifest.model,architecture:{input_modalities:['image','text']}}]});
  if (String(url).endsWith('/chat/completions')) { descriptionCalls++; return Response.json({model:env.DESCRIPTION_MODEL,choices:[{finish_reason:'stop',message:{content:cache.descriptions[query.sha256]}}]}); }
  if (String(url).endsWith('/embeddings')) {embeddingCalls++;return Response.json({model:manifest.model,data:[{embedding:cache.vectors[query.sha256]}]});}
  throw Error('No network permitted');
};
env.VECTORIZE = {query:async(vector,options)=>{
  indexCalls++;
  return {matches:refs.map(r=>({id:r.vector_id,metadata:{artifact_id:r.id},score:dot(r.vector,vector)}))
    .filter(r=>!options.filter||r.metadata.artifact_id!==options.filter.artifact_id.$ne).sort((a,b)=>b.score-a.score).slice(0,options.topK)};
}};
const rows=[];
try {
  for(const q of manifest.entries.filter(e=>e.partition==='calibration')) {
    assert.ok(cache.descriptions[q.sha256]);assert.ok(cache.vectors[q.sha256]);
    query=q;
    db.sqlite.prepare('UPDATE recognition_hard_negatives SET enabled=CASE WHEN digest=? THEN 0 ELSE 1 END').run(q.sha256);
    const vector=normalize(cache.vectors[q.sha256]);
    const groups=new Map();
    for(const ref of refs) {const old=groups.get(ref.id);const score=dot(ref.vector,vector);if(!old||score>old.score) groups.set(ref.id,{...ref,score});}
    const ranking=[...groups.values()].sort((a,b)=>b.score-a.score);
    const top=ranking[0],base=top.score>=.8&&top.score-ranking[1].score>=.05;
    const scores=hard.filter(h=>h.enabled&&h.signature===manifest.signature&&h.target_artifact_id===top.id&&h.digest!==q.sha256).map(h=>dot(h.normalized,vector));
    const veto=top.external_object_id===HARD_NEGATIVE_TARGET&&base&&scores.length>0&&top.score-Math.max(...scores)<-.08;
    const r=await recognize(new Uint8Array([255,216,255,217]).buffer,env);
    const predicted = refs.find(ref=>ref.id===r.artifact_id)?.external_object_id || top.external_object_id;
    rows.push({file:q.file,scenario:q.scenario,expected:q.expected,predicted,prior_accept:base&&!veto,accepted:r.recognized,reason:r.reason,scene:r.semantic_guard?.scene,family:r.family});
  }
} finally {globalThis.fetch=nativeFetch;db.sqlite.close();}
function metrics(key) {
  const accepted=rows.filter(r=>r[key]);
  return {accepted:accepted.length,correct_known:accepted.filter(r=>r.scenario.startsWith('known_')&&r.predicted===r.expected).length,
    wrong_known:accepted.filter(r=>r.scenario.startsWith('known_')&&r.predicted!==r.expected).length,negative_false_accept:accepted.filter(r=>!r.scenario.startsWith('known_')).length,
    phat_ba_correct:accepted.filter(r=>r.expected===HARD_NEGATIVE_TARGET&&r.predicted===r.expected).length};
}
const semantic=rows.filter(r=>['multiple_artifacts','no_clear_artifact'].includes(r.reason));
const lost=rows.filter(r=>r.prior_accept&&!r.accepted&&r.scenario.startsWith('known_'));
const report={scope:'Actual recognize() replay, 10 production reference vectors, cached descriptions and query vectors. No paid calls; exact cached search, not live Vectorize. Geometry OFF. Calibration already inspected; not independent validation.',
  created_at:new Date().toISOString(),real_provider_calls:0,final_scored:false,reference_count:refs.length,calibration_count:rows.length,leave_one_out:true,
  prior_hard_negative_policy:metrics('prior_accept'),algorithm_first:metrics('accepted'),semantic_rejects:semantic.length,
  mock_calls:{description:descriptionCalls,embedding:embeddingCalls,index:indexCalls},lost_known_accepts:lost,rows};
assert.equal(rows.length,508);assert.equal(rows.filter(r=>r.accepted&&!r.prior_accept).length,0,'Geometry off must not introduce new accepts');
await mkdir(resolve(root,out),{recursive:true});
await writeFile(resolve(root,out,'production-worker-replay.json'),JSON.stringify(report,null,2)+'\n');
await writeFile(resolve(root,out,'summary.md'),`# Algorithm-first production-snapshot replay\n\n${report.scope}\n\n- Rows: ${rows.length}; references: ${refs.length}; real provider calls: 0; final scored: false.\n- Previous guarded policy: ${JSON.stringify(report.prior_hard_negative_policy)}\n- Algorithm-first: ${JSON.stringify(report.algorithm_first)}\n- Semantic rejections: ${semantic.length}; lost known accepts: ${lost.length}.\n- Mock calls: ${JSON.stringify(report.mock_calls)}\n\nGeometry is OFF, not a live rescue claim. No labels, references or production catalog were changed.\n`);
console.log(JSON.stringify({...report,rows:undefined,lost_known_accepts:lost.length},null,2));
