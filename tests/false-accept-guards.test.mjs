import test from 'node:test';
import assert from 'node:assert/strict';
import worker, { recognize } from '../worker/index.js';
import { database, envDefaults, seed, imageBlob } from './fixtures.mjs';
import { signature } from '../worker/pipeline.js';
import { validateRelease, buildGalleryPayloads } from '../scripts/seed-false-accept-guards.mjs';
import release from '../data/hard-negative-releases/false-accept-gallery-v1.json' with { type:'json' };

const unit = x => [x,Math.sqrt(1-x*x),...Array(1534).fill(0)];
test('gallery guard release pins nine previously computed vectors for four target-scoped groups',()=>{
 assert.equal(validateRelease().owner_production_approved,true);
 const payloads=buildGalleryPayloads();assert.deepEqual(payloads.map(p=>p.vectors.length),[5,2,1,1]);assert.equal(new Set(payloads.flatMap(p=>p.vectors.map(v=>v.id))).size,9);
 for(const p of payloads)for(const v of p.vectors)assert.ok(Math.abs(Math.hypot(...v.vector)-1)<1e-12);
 for(const bad of [{...release,owner_production_approved:false},{...release,signature:'wrong'},{...release,production_gap:-.08},{...release,banks:release.banks.slice(1)}])assert.throws(()=>validateRelease(bad));
});
for(const [index,bank] of release.banks.entries())test(`actual Worker admin installs ${bank.group_key} and only vetoes its target`,async()=>{
 const db=database(),env={...envDefaults,DB:db,RECOGNITION_HARD_NEGATIVE_GAP:'-0.009',JEV_MODE:'off'},original=globalThis.fetch;seed(db,2,signature(env));
 db.sqlite.prepare('UPDATE artifacts SET external_object_id=? WHERE id=?').run(bank.target_external_object_id,'a1');
 db.sqlite.prepare('UPDATE artifacts SET external_object_id=? WHERE id=?').run('stamp-giong','a2');
 const api=(path,settings={})=>worker.fetch(new Request('http://localhost'+path,settings),env);
 let current=bank.vectors[0].vector,score=.84,winner='a1',calls=0;
 env.VECTORIZE={query:async()=>({matches:[{id:'v1',score:winner==='a1'?score:.5,metadata:{artifact_id:'a1'}},{id:'v2',score:winner==='a2'?score:.5,metadata:{artifact_id:'a2'}}]})};
 globalThis.fetch=async(url)=>{if(String(url).endsWith('/models'))return Response.json({data:[{id:env.OPENROUTER_MODEL,architecture:{input_modalities:['image']}}]});assert.ok(String(url).endsWith('/embeddings'));calls++;return Response.json({model:env.OPENROUTER_MODEL,data:[{embedding:current}]});};
 try{
  const before=db.sqlite.prepare('SELECT * FROM reference_images ORDER BY id').all();
  // An unrelated pre-existing guard must survive the new bank installation.
  db.sqlite.prepare('INSERT INTO recognition_hard_negatives(id,target_artifact_id,signature,group_key,digest,vector)VALUES(?,?,?,?,?,?)').run('preserved-'+index,'a2',signature(env),'preserved-'+index,'e'.repeat(64),JSON.stringify(unit(.1)));
  const existing=db.sqlite.prepare('SELECT * FROM recognition_hard_negatives').get();
  const body={...buildGalleryPayloads()[index],signature:signature(env)};
  const install=()=>api('/api/admin/hard-negatives/'+bank.group_key,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  assert.equal((await install()).status,200);assert.equal((await install()).status,200);
  assert.deepEqual(db.sqlite.prepare('SELECT * FROM recognition_hard_negatives WHERE id=?').get(existing.id),existing);
  assert.deepEqual(db.sqlite.prepare('SELECT * FROM reference_images ORDER BY id').all(),before);
  assert.equal(calls,0);
  for(const v of bank.vectors){current=v.vector;score=.84;winner='a1';const r=await recognize(await imageBlob().arrayBuffer(),env);assert.equal(r.recognized,false);assert.equal(r.artifact_id,null);assert.equal(r.artifact,null);assert.equal(r.decision_source,null);assert.equal(r.reason,'hard_negative_conflict');assert.equal(r.status,'uncertain');assert.equal(r.candidates[0].id,'a1');}
  current=unit(0);score=.99;winner='a1';let r=await recognize(await imageBlob().arrayBuffer(),env);assert.equal(r.recognized,true);
  current=bank.vectors[0].vector;winner='a2';score=.95;r=await recognize(await imageBlob().arrayBuffer(),env);assert.equal(r.recognized,true);assert.equal(r.artifact_id,'a2');assert.equal(r.hard_negative_score,null);
 }finally{globalThis.fetch=original;db.sqlite.close();}
});
