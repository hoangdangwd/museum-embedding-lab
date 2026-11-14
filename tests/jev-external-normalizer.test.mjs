import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { CodecPool } from '../services/jev-normalizer/pool.mjs';
import { normalize } from '../services/jev-normalizer/codec.mjs';
import { normalizeRemoteQuery, normalizeJevPair, provisionJevReference, REFERENCE_PREFIX, NORMALIZER_VERSION } from '../worker/jev-normalizer.js';
import { applyJev } from '../worker/jev.js';
import { signature } from '../worker/pipeline.js';
import { database } from './fixtures.mjs';
import cache from '../data/jev-reference-cache.json' with { type: 'json' };
import release from '../data/production-catalog.json' with { type: 'json' };
const hash = b => createHash('sha256').update(b).digest('hex');
const source = await readFile(new URL('../data/' + release.entries[0].file, import.meta.url));
const output = await normalize(source), token = 'test-only-token-abcdefghijklmnopqrstuvwxyz0123456789';
const remote = { JEV_NORMALIZER_URL:'https://normalizer.example/v1/normalize',JEV_NORMALIZER_TOKEN:token,JEV_IMAGE_PROCESSOR:'remote',JEV_NORMALIZER_TIMEOUT_MS:'150' };
const goodHeaders = {'content-type':'image/jpeg','x-normalization-version':NORMALIZER_VERSION,'x-source-sha256':hash(source),'x-output-sha256':hash(output)};
const good = () => new Response(output,{headers:goodHeaders});

test('reference manifest pins only32 exact approved source/destination bytes',()=>{
 assert.equal(cache.release_id,release.id);assert.equal(cache.normalization,NORMALIZER_VERSION);assert.equal(cache.entries.length,32);
 assert.equal(new Set(cache.entries.map(e=>e.source_sha256)).size,32);
 for(const e of cache.entries){assert.ok(release.entries.some(r=>r.digest===e.source_sha256&&r.artifact_id===e.artifact_id));assert.ok(e.bytes<=4194304);}
 assert.equal(hash(output),cache.entries.find(e=>e.source_sha256===hash(source)).output_sha256);
});
for(const [name,reply] of [
 ['redirect',()=>new Response(null,{status:302,headers:{location:'https://other.example/'}})],
 ['service error',()=>new Response(null,{status:503})],
 ['wrong MIME',()=>new Response(output,{headers:{...goodHeaders,'content-type':'text/plain'}})],
 ['wrong version',()=>new Response(output,{headers:{...goodHeaders,'x-normalization-version':'wrong'}})],
 ['wrong input hash',()=>new Response(output,{headers:{...goodHeaders,'x-source-sha256':'0'.repeat(64)}})],
 ['wrong output hash',()=>new Response(output,{headers:{...goodHeaders,'x-output-sha256':'0'.repeat(64)}})],
 ['oversize Content-Length',()=>new Response(output,{headers:{...goodHeaders,'content-length':'4194305'}})],
 ['oversize stream',()=>new Response(new Uint8Array(4194305),{headers:goodHeaders})],
 ['bad JPEG with matching hash',()=>new Response(new Uint8Array([1,2,3]),{headers:{...goodHeaders,'x-output-sha256':hash(new Uint8Array([1,2,3]))}})],
 ['fetch hangs',()=>new Promise(()=>{})],
 ['body hangs',()=>new Response(new ReadableStream({start(c){c.enqueue(new Uint8Array([255]));}}),{headers:goodHeaders})],
])test(`external ${name} is bounded/fail-closed without retry or codec fallback`,async()=>{
 let calls=0;const start=Date.now();await assert.rejects(normalizeRemoteQuery(source,remote,async()=>{calls++;return reply();}),/NORMALIZER_UNAVAILABLE/);assert.equal(calls,1);assert.ok(Date.now()-start<2500);
});
test('external config rejects HTTP, credentials, query strings, missing token and missing mode',async()=>{
 for(const patch of [{JEV_NORMALIZER_URL:'http://example/v1/normalize'},{JEV_NORMALIZER_URL:'https://user:secret@example/v1/normalize'},{JEV_NORMALIZER_URL:'https://example/v1/normalize?secret=x'},{JEV_NORMALIZER_TOKEN:''},{JEV_NORMALIZER_TIMEOUT_MS:'NaN'}])await assert.rejects(normalizeRemoteQuery(source,{...remote,...patch},async()=>assert.fail('must not call')));
 await assert.rejects(normalizeJevPair(source,source,{},async()=>assert.fail('must not call')));
});
const baseEnv={ALLOW_ADMIN_LOCAL:'true',JEV_MODE:'enforce',JEV_IMAGE_PROCESSOR:'remote',OPENROUTER_API_KEY:'synthetic-test-token',RECOGNITION_PIPELINE:'image-description-v1',OPENROUTER_MODEL:'google/gemini-embedding-2',DESCRIPTION_MODEL:'google/gemini-2.5-flash',EMBEDDING_DIMENSIONS:'1536',EMBEDDING_VERSION:'1',PREPROCESS_VERSION:'rgb-exif-white-jpeg95-max1600-v1',DAILY_EMBEDDING_LIMIT:'100000',RECOGNITION_THRESHOLD:'.8',RECOGNITION_MARGIN:'.05',RECOGNITION_HARD_NEGATIVE_GAP:'-.009',...remote};
function fixture(){
 const db=database(),entry=release.entries[0],store=new Map();
 db.sqlite.prepare('INSERT INTO artifacts(id,name,name_key,external_object_id) VALUES(?,?,?,?)').run('a1',entry.name,'one',entry.artifact_id);
 db.sqlite.prepare(`INSERT INTO reference_images(id,artifact_id,filename,digest,r2_key,vector_id,status,signature,vector_json) VALUES('r1','a1','one.jpg',?,'k1','v1','ready',?,?)`).run(entry.digest,signature(baseEnv),JSON.stringify(entry.vector));
 const object=bytes=>({size:bytes.length,arrayBuffer:async()=>bytes});store.set('k1',object(source));
 const env={...baseEnv,DB:db,IMAGES:{get:async key=>store.get(key),put:async(key,bytes)=>store.set(key,object(bytes))}};
 const winner={id:'a1',external_object_id:entry.artifact_id,reference:{vector_id:'v1',digest:entry.digest}};
 return {db,env,store,winner};
}
test('provisioner accepts only pinned derivative bytes and does not modify catalog/vectors',async()=>{
 const f=fixture(),digest=hash(source),url='http://localhost/api/admin/jev/references/'+digest;
 try{
  const before=f.db.sqlite.prepare('SELECT * FROM reference_images').all();
  let response=await provisionJevReference(new Request(url,{method:'PUT',headers:{'content-type':'image/jpeg'},body:new Uint8Array([1,2,3])}),f.env,digest);assert.equal(response.status,409);assert.equal(f.store.size,1);
  response=await provisionJevReference(new Request(url,{method:'PUT',headers:{'content-type':'image/jpeg'},body:output}),f.env,digest);assert.equal(response.status,200);assert.equal(f.store.size,2);
  const ready=await provisionJevReference(new Request(url),f.env,digest);assert.equal((await ready.json()).ready,true);
  assert.deepEqual(f.db.sqlite.prepare('SELECT * FROM reference_images').all(),before);
 }finally{f.db.sqlite.close();}
});
test('actual remote applyJev confirms/vetoes exact top1; outage/cache corruption cannot retain identity',async()=>{
 const f=fixture(),original=globalThis.fetch,baseline={recognized:true,status:'matched',artifact_id:'a1',artifact:'one',source:'embedding',decision_source:'embedding',candidates:[{id:'a1'},{id:'a2'}],timings:{}};
 f.store.set(REFERENCE_PREFIX+hash(source)+'.jpg',{size:output.length,arrayBuffer:async()=>output});
 try{
  for(const probability of [.9,.2]){
   let normalizerCalls=0,providerCalls=0;
   globalThis.fetch=async(url,settings)=>{
    if(url===remote.JEV_NORMALIZER_URL){normalizerCalls++;assert.deepEqual(Buffer.from(settings.body),source);return good();}
    assert.equal(url,'https://openrouter.ai/api/alpha/decisions');providerCalls++;const body=JSON.parse(settings.body);assert.deepEqual(Buffer.from(body.state[1].image_url.url.split(',')[1],'base64'),Buffer.from(output));
    assert.deepEqual(Buffer.from(body.state[3].image_url.url.split(',')[1],'base64'),Buffer.from(output));
    return Response.json({model:'typesafe/jev-1.14-20261014',provider:'TypeSafe',answers:{same_physical_artwork:{type:'noul',noul:probability}},usage:{cost:.0001}});
   };
   const verdict=await applyJev(baseline,source,f.env,f.winner);assert.equal(verdict.recognized,probability>=.5);assert.equal(normalizerCalls,1);assert.equal(providerCalls,1);
  }
  for(const kind of ['unavailable','missing','corrupt']){
   if(kind==='missing')f.store.delete(REFERENCE_PREFIX+hash(source)+'.jpg');
   if(kind==='corrupt')f.store.set(REFERENCE_PREFIX+hash(source)+'.jpg',{size:output.length,arrayBuffer:async()=>new Uint8Array(output.length)});
   globalThis.fetch=async url=>{assert.equal(url,remote.JEV_NORMALIZER_URL);return new Response(null,{status:503});};
   const verdict=await applyJev(baseline,source,f.env,f.winner);assert.equal(verdict.reason,'pairwise_verifier_unavailable');for(const k of ['artifact','artifact_id','source','decision_source'])assert.equal(verdict[k],null);
  }
 }finally{globalThis.fetch=original;f.db.sqlite.close();}
});
test('codec pool refuses unbounded queues and recovers after timeout',async()=>{
 const pool=new CodecPool(1,1);
 try{await assert.rejects(pool.run(source),/TIMEOUT/);pool.timeout=5000;const running=pool.run(source);await assert.rejects(pool.run(source),/BUSY/);assert.equal(hash(await running),hash(output));}
 finally{await pool.close();}
});
test('real external HTTP service normalizes all32 approved JPEGs byte-identically; auth/binding/overload checked',async()=>{
 const child=spawn(process.execPath,['services/jev-normalizer/server.mjs'],{env:{...process.env,PORT:'0',JEV_NORMALIZER_TOKEN:token,CODEC_CONCURRENCY:'2'},stdio:['ignore','pipe','pipe']});
 let stderr='';child.stderr.on('data',b=>stderr+=b);
 try{
  const port=await new Promise((resolve,reject)=>{let text='';const timer=setTimeout(()=>reject(Error('service startup timeout')),10000);child.stdout.on('data',b=>{text+=b;const match=/listening on (\d+)/.exec(text);if(match){clearTimeout(timer);resolve(match[1]);}});child.once('exit',()=>{clearTimeout(timer);reject(Error('service exited '+stderr));});});
  const url=`http://127.0.0.1:${port}/v1/normalize`,send=(bytes,patch={})=>fetch(url,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'image/jpeg','X-Normalization-Version':NORMALIZER_VERSION,'X-Source-Sha256':hash(bytes),...patch},body:bytes});
  assert.equal((await send(source,{Authorization:'Bearer invalid'})).status,401);
  assert.equal((await send(source,{'X-Source-Sha256':'0'.repeat(64)})).status,400);
  for(const expected of cache.entries){
   const entry=release.entries.find(e=>e.digest===expected.source_sha256),bytes=await readFile(new URL('../data/'+entry.file,import.meta.url)),before=hash(bytes);
   const r=await send(bytes);assert.equal(r.status,200);assert.equal(r.headers.get('cache-control'),'no-store');assert.equal(r.headers.get('x-source-sha256'),before);assert.equal(hash(new Uint8Array(await r.arrayBuffer())),expected.output_sha256);assert.equal(hash(bytes),before);
  }
  const burst=await Promise.all(Array.from({length:10},()=>send(source)));assert.ok(burst.some(r=>r.status===429));assert.ok(burst.every(r=>[200,429].includes(r.status)));await Promise.all(burst.map(r=>r.arrayBuffer()));
 }finally{child.kill();await once(child,'exit').catch(()=>{});}
});
