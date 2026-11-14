import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import release from '../data/production-catalog.json' with { type: 'json' };
import worker from '../worker/index.js';
import { normalize, signature, vectorScope } from '../worker/pipeline.js';
import { exactReleaseReferenceScore } from '../worker/catalog-release.js';
import boundaryQuery from './fixtures/catalog-boundary-query.json' with { type: 'json' };
import { database } from './fixtures.mjs';
import { prepareProductionCatalog, seedArtifacts } from '../scripts/seed-artifacts.mjs';
const hash = b => createHash('sha256').update(b).digest('hex');
const first = release.entries[0];
const jpeg = e => readFile(new URL(`../data/${e.file}`, import.meta.url));
const config = { ALLOW_ADMIN_LOCAL: 'true', RECOGNITION_PIPELINE: 'image-description-v1', OPENROUTER_MODEL: 'google/gemini-embedding-2', DESCRIPTION_MODEL: 'google/gemini-2.5-flash', EMBEDDING_DIMENSIONS: '1536', EMBEDDING_VERSION: '1', PREPROCESS_VERSION: 'rgb-exif-white-jpeg95-max1600-v1', DAILY_EMBEDDING_LIMIT: '0', RECOGNITION_THRESHOLD: '.8', RECOGNITION_MARGIN: '.05', RECOGNITION_HARD_NEGATIVE_GAP: '-.08' };
async function fixture(fn) {
  const db = database(), objects = new Map(), vectors = new Map(), calls = [], original = globalThis.fetch;
  let provider = 0, failIndex = false;
  globalThis.fetch = async () => { provider++; throw Error('NO PAID CALLS AUTHORIZED'); };
  const env = { ...config, DB: db,
    IMAGES: { put: async (k,v) => objects.set(k,v), get: async k => objects.has(k) ? { body: objects.get(k), arrayBuffer: async () => objects.get(k) } : null, delete: async k => objects.delete(k) },
    VECTORIZE: { upsert: async rows => { if (failIndex) throw Error('Index temporarily unavailable'); for (const r of rows) vectors.set(r.id,r); }, deleteByIds: async ids => ids.forEach(id => vectors.delete(id)), getByIds: async ids => { assert.ok(ids.length <= 20, 'Vectorize getByIds batch limit'); return ids.flatMap(id => vectors.has(id) ? [vectors.get(id)] : []); } },
  };
  function createArtifact(e = first) { const id = `internal-${e.artifact_id}`; db.sqlite.prepare('INSERT OR IGNORE INTO artifacts(id,name,name_key,external_object_id) VALUES(?,?,?,?)').run(id,e.name,id,e.artifact_id); return id; }
  const raw = async (path, options = {}, customEnv = env) => { calls.push({path,method:options.method||'GET'}); return worker.fetch(new Request('http://localhost'+path, options),customEnv); };
  const api = async (path, options = {}, binary = false) => { const r = await raw(path,options); if (!r.ok) throw Error(`HTTP ${r.status}: ${(await r.json()).detail}`); return binary ? Buffer.from(await r.arrayBuffer()) : r.json(); };
  const form = async (entry = first, edits = {}) => { const f = new FormData(); f.set('file', new Blob([edits.bytes || await jpeg(entry)],{type:'image/jpeg'}),entry.review_id+'.jpg'); f.set('catalog_release', edits.release ?? release.id); if (edits.clientVector) { f.set('vector',JSON.stringify(edits.clientVector)); f.set('description','Injected client description must not be used'); } return f; };
  try { await fn({db,env,objects,vectors,calls,raw,api,form,createArtifact,provider:()=>provider,setFail:value=>{failIndex=value;}}); assert.equal(provider,0); }
  finally { globalThis.fetch=original;db.sqlite.close(); }
}

test('bank32 preserves every bank30 entry and adds two safe Binh phong views', async () => {
  assert.equal(hash(JSON.stringify(release.entries.slice(0,30))),'a44ad41003dd77c4a9c4322d22d7e0c1c179490cfd0b7b25100ad5945bd0870c');
  assert.deepEqual(release.entries.slice(30).map(e=>e.review_id),['S2001','S2003']);
  assert.ok(release.entries.slice(30).every(e=>e.artifact_id==='stamp-binh-phong'&&e.source_crop===null));
  assert.equal(release.id,'crop-bank32-session2-v1');assert.equal(release.owner_production_approved,true);assert.equal(release.paid_calls_authorized_for_provisioning,0);assert.equal(release.entries.length,32);assert.equal(new Set(release.entries.map(e=>e.artifact_id)).size,9);assert.equal(new Set(release.entries.map(e=>e.digest)).size,32);assert.equal(release.entries.some(e=>e.review_id==='R1090'),false);assert.equal(release.entries.filter(e=>e.baseline_verbatim_live_bytes).length,10);assert.equal(release.independent_validation,false);assert.equal(signature(config),release.signature);
  for(const e of release.entries){assert.equal(hash(await jpeg(e)),e.digest);assert.equal(normalize(e.vector).length,1536);assert.ok(e.file.startsWith('catalog-releases/'));}
  assert.equal(release.entries.find(e=>e.review_id==='B1638').digest,'6925a1ddd024aec0a7a6b7b712fbbecd111a32b7f1964ae4a2a46b7d0f6d7e4c');
  const payload=release.id+'|'+release.signature+'\n'+release.entries.map(e=>e.artifact_id+'|'+e.digest+'|'+e.review_id).sort().join('\n');assert.equal(hash(payload),release.reference_set_sha256);
});

test('approved import stores trusted vector/description with no API key, quota or provider calls', async()=>fixture(async f=>{
  const id=f.createArtifact(),r=await f.raw(`/api/admin/artifacts/${id}/images`,{method:'POST',body:await f.form(first,{clientVector:[999]})});assert.equal(r.status,201);const result=await r.json();assert.equal(result.provider_calls,0);assert.equal(result.catalog_release,release.id);
  const row=f.db.sqlite.prepare('SELECT * FROM reference_images').get();assert.equal(row.digest,first.digest);assert.equal(row.description,first.description);assert.deepEqual(JSON.parse(row.vector_json),normalize(first.vector));assert.equal(row.status,'ready');assert.equal(f.objects.size,1);assert.equal(f.vectors.size,1);assert.equal(f.vectors.get(row.vector_id).metadata.artifact_id,id);assert.equal(f.vectors.get(row.vector_id).namespace,(await vectorScope(config)).namespace);assert.equal(f.db.sqlite.prepare('SELECT COUNT(*) AS n FROM usage_buckets').get().n,0);
}));

for(const [label,edits]of [['wrong release',{release:'unapproved'}],['empty release',{release:''}],['altered JPEG',{bytes:Buffer.from([255,216,255,224,0,255,217])}]])test(`${label} rejected before writes and never falls back to model`,async()=>fixture(async f=>{const id=f.createArtifact(),r=await f.raw(`/api/admin/artifacts/${id}/images`,{method:'POST',body:await f.form(first,edits)});assert.equal(r.status,409);assert.equal(f.objects.size,0);assert.equal(f.db.sqlite.prepare('SELECT COUNT(*) AS n FROM reference_images').get().n,0);}));

test('right JPEG cannot be assigned to a different artifact',async()=>fixture(async f=>{const id=f.createArtifact(release.entries.find(e=>e.artifact_id!==first.artifact_id));const r=await f.raw(`/api/admin/artifacts/${id}/images`,{method:'POST',body:await f.form()});assert.equal(r.status,409);assert.equal(f.objects.size,0);}));

test('pipeline mismatch fails closed before saving or charging',async()=>fixture(async f=>{const id=f.createArtifact(),r=await f.raw(`/api/admin/artifacts/${id}/images`,{method:'POST',body:await f.form()},{...f.env,EMBEDDING_VERSION:'different'});assert.equal(r.status,409);assert.equal(f.objects.size,0);}));

test('duplicate exact JPEG remains a conflict without extra writes',async()=>fixture(async f=>{const id=f.createArtifact();assert.equal((await f.raw(`/api/admin/artifacts/${id}/images`,{method:'POST',body:await f.form()})).status,201);assert.equal((await f.raw(`/api/admin/artifacts/${id}/images`,{method:'POST',body:await f.form()})).status,409);assert.equal(f.objects.size,1);assert.equal(f.vectors.size,1);}));

test('release import still requires existing admin authorization',async()=>fixture(async f=>{const id=f.createArtifact(),r=await worker.fetch(new Request(`https://remote.example/api/admin/artifacts/${id}/images`,{method:'POST',body:await f.form()}),f.env);assert.equal(r.status,403);assert.equal(f.objects.size,0);}));

test('failed Vectorize import preserves cached vector; explicit reindex costs no model call',async()=>fixture(async f=>{const id=f.createArtifact();f.setFail(true);assert.equal((await f.raw(`/api/admin/artifacts/${id}/images`,{method:'POST',body:await f.form()})).status,502);const row=f.db.sqlite.prepare('SELECT * FROM reference_images').get();assert.equal(row.status,'failed');assert.ok(row.vector_json);f.setFail(false);const result=await f.api(`/api/admin/images/${row.id}/reindex`,{method:'POST'});assert.equal(result.status,'ready');assert.equal(f.vectors.size,1);}));

test('default seed provisions exact bundle, verifies real index values and is idempotent',async()=>fixture(async f=>{
  const catalog=await prepareProductionCatalog();assert.equal(catalog.flatMap(e=>e.references).length,32);assert.ok(catalog.flatMap(e=>e.references).every(e=>e.catalog_release===release.id));
  let result=await seedArtifacts(f.api,catalog,{apply:true,log:()=>{}});assert.equal(result.filter(r=>r.action==='error').length,0);assert.equal(f.db.sqlite.prepare('SELECT COUNT(*) AS n FROM reference_images').get().n,32);assert.equal(f.objects.size,32);assert.equal(f.vectors.size,32);
  const writes=f.calls.filter(c=>c.method!=='GET').length;result=await seedArtifacts(f.api,catalog,{apply:true,log:()=>{}});assert.ok(result.every(r=>r.imports.every(i=>i.action==='skip')));assert.equal(f.calls.filter(c=>c.method!=='GET').length,writes);
  const status=await f.api('/api/admin/catalog-release?check_index=1');assert.equal(status.catalog_complete,true);assert.equal(status.index.verified,true);assert.equal(status.index.vectors_found,32);assert.equal(status.provider_calls,0);
  const vector=[...f.vectors.values()][0];vector.namespace='wrong-namespace';assert.equal((await f.api('/api/admin/catalog-release?check_index=1')).index.verified,false);
}));

test('dry run uses only GET and no artifact/image writes',async()=>fixture(async f=>{const result=await seedArtifacts(f.api,await prepareProductionCatalog(),{log:()=>{}});assert.ok(result.every(r=>r.action==='ready'));assert.ok(f.calls.every(c=>c.method==='GET'));assert.equal(f.objects.size,0);assert.equal(f.db.sqlite.prepare('SELECT COUNT(*) AS n FROM artifacts').get().n,0);}));

test('exact cosine rejects known ANN false accept at the0.8 boundary without changing thresholds',()=>{
  const e=release.entries.find(e=>e.review_id==='R0597');
  const exact=exactReleaseReferenceScore(e.digest,e.artifact_id,JSON.stringify(e.vector),normalize(boundaryQuery.vector),config);
  assert.ok(Math.abs(exact-.7999717802121104)<1e-12);assert.ok(exact<.8);assert.ok(.8000294>=.8);
  assert.throws(()=>exactReleaseReferenceScore(e.digest,e.artifact_id,null,normalize(boundaryQuery.vector),config),/thiếu\/hỏng/);
  assert.equal(exactReleaseReferenceScore('unapproved-legacy',e.artifact_id,null,normalize(boundaryQuery.vector),config),null);
});

test('actual recognize reranks the approved bank and does not accept rounded-up ANN scores',async()=>fixture(async f=>{
  const refs=[release.entries.find(e=>e.review_id==='R0597'),release.entries.find(e=>e.review_id==='R1610')],ids=[];
  for(const e of refs){const id=f.createArtifact(e),r=await f.api(`/api/admin/artifacts/${id}/images`,{method:'POST',body:await f.form(e)});ids.push(r.id);}
  const previous=globalThis.fetch;
  f.env.OPENROUTER_API_KEY='mock-only-no-real-provider';f.env.DAILY_EMBEDDING_LIMIT='200';
  globalThis.fetch=async url=>String(url).endsWith('/models')?Response.json({data:[{id:config.OPENROUTER_MODEL,architecture:{input_modalities:['image','text']}}]}):String(url).endsWith('/chat/completions')?Response.json({model:config.DESCRIPTION_MODEL,choices:[{finish_reason:'stop',message:{content:'A single seated crowned statue with hands resting low on its thighs.'}}]}):Response.json({model:config.OPENROUTER_MODEL,data:[{embedding:boundaryQuery.vector}]});
  f.env.VECTORIZE.query=async()=>({matches:ids.map((id,i)=>({id,score:i===0?.8000294:.7494025,metadata:{artifact_id:`internal-${refs[i].artifact_id}`}}))});
  try{const form=new FormData();form.set('file',new Blob([Buffer.from([255,216,255,224,0,255,217])]),'query.jpg');const result=await f.api('/api/admin/query',{method:'POST',body:form},false);assert.equal(result.recognized,false);assert.equal(result.reason,'below_threshold');assert.equal(result.threshold,.8);assert.equal(result.margin,.05);}finally{globalThis.fetch=previous;}
}));

test('older/mismatched server is rejected before uploads, never paid fallback',async()=>{const calls=[];await assert.rejects(seedArtifacts(async(path,opts={})=>{calls.push(opts.method||'GET');return {mode:'unsupported'};},await prepareProductionCatalog(),{apply:true}),/refusing uploads/);assert.deepEqual(calls,['GET']);});
