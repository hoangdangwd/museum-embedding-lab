import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { database } from './fixtures.mjs';
import release from '../data/production-catalog.json' with {type:'json'};
import { signature, normalize } from '../worker/pipeline.js';
import { reserveJev, settleJev, jevConfig, jevStatus, RESERVATION_MICROUSD } from '../worker/jev-budget.js';
import { verifyBody, PROMPT, ENDPOINT, RESPONSE_MODEL } from '../worker/jev-protocol.js';
import { normalizeJevImage, jpegFrame, fitPixels } from '../worker/jev-images.js';
import { normalizeRemoteQuery, NORMALIZER_VERSION } from '../worker/jev-normalizer.js';
register(new URL('./wasm-loader.mjs',import.meta.url));
const {applyJev}=await import('../worker/jev.js');
const {recognize,default:worker}=await import('../worker/index.js');
const jpeg=e=>readFile(new URL('../data/'+e.file,import.meta.url));
const baseEnv={ALLOW_ADMIN_LOCAL:'true',JEV_IMAGE_PROCESSOR:'local',JEV_MODE:'enforce',OPENROUTER_API_KEY:'synthetic-test-token-no-secrets',RECOGNITION_PIPELINE:'image-description-v1',OPENROUTER_MODEL:'google/gemini-embedding-2',DESCRIPTION_MODEL:'google/gemini-2.5-flash',EMBEDDING_DIMENSIONS:'1536',EMBEDDING_VERSION:'1',PREPROCESS_VERSION:'rgb-exif-white-jpeg95-max1600-v1',DAILY_EMBEDDING_LIMIT:'100000',RECOGNITION_THRESHOLD:'.8',RECOGNITION_MARGIN:'.05',RECOGNITION_HARD_NEGATIVE_GAP:'-.009'};
const entry=release.entries[0],baseline={recognized:true,status:'matched',artifact_id:'a1',artifact:entry.name,source:'embedding',decision_source:'embedding',candidates:[{id:'a1'},{id:'a2'}],timings:{embedding_ms:2}};
const winner={id:'a1',external_object_id:entry.artifact_id,reference:{vector_id:'v1',digest:entry.digest}};
const answer=(p=.9,extras={})=>Response.json({model:RESPONSE_MODEL,provider:'TypeSafe',answers:{same_physical_artwork:{type:'noul',noul:p}},usage:{cost:.0004},...extras});
async function fixture(fn){
 const db=database(),bytes=await jpeg(entry);db.sqlite.prepare('INSERT INTO artifacts(id,name,name_key,external_object_id) VALUES(?,?,?,?)').run('a1',entry.name,'one',entry.artifact_id);
 db.sqlite.prepare(`INSERT INTO reference_images(id,artifact_id,filename,digest,r2_key,vector_id,status,signature,vector_json) VALUES('r1','a1','one.jpg',?,'k1','v1','ready',?,?)`).run(entry.digest,signature(baseEnv),JSON.stringify(entry.vector));
 let storageReads=0;const env={...baseEnv,DB:db,IMAGES:{async get(key){storageReads++;assert.equal(key,'k1');return {size:bytes.length,arrayBuffer:async()=>bytes};}}};const original=globalThis.fetch;let calls=0;
 globalThis.fetch=async(url,init)=>{calls++;assert.equal(url,ENDPOINT);assert.equal(init.redirect,'manual');return answer();};
 try{await fn({db,env,bytes,calls:()=>calls,reads:()=>storageReads});}finally{globalThis.fetch=original;db.sqlite.close();}
}
test('runtime protocol prompt is byte-identical to frozen v2 instructions',async()=>{const frozen=(await readFile(new URL('../worker/jev-protocol.js',import.meta.url),'utf8'));assert.ok(frozen.includes('When blur, cropping, occlusion'));assert.equal(PROMPT.length,1224);});
test('real WASM normalizer decodes/reencodes all32 approvedJPEGs and strips metadata',async()=>{
 for(const e of release.entries){const bytes=await jpeg(e),before=createHash('sha256').update(bytes).digest('hex'),out=await normalizeJevImage(bytes);const frame=jpegFrame(out);assert.ok(Math.min(frame.width,frame.height)>=280);assert.ok(Math.max(frame.width,frame.height)<=1568);assert.equal(Buffer.from(out).includes(Buffer.from('Exif')),false);assert.equal(createHash('sha256').update(bytes).digest('hex'),before);}
});
test('normalizer white-pads thin views without stretching and rejects allocation bombs',async()=>{
 const p=fitPixels({width:64,height:1600,data:new Uint8ClampedArray(64*1600*4).fill(100)});assert.deepEqual([p.width,p.height],[280,1568]);assert.deepEqual([...p.data.slice(0,4)],[255,255,255,255]);
 const b=Buffer.from(await jpeg(entry));const i=b.indexOf(Buffer.from([255,192]));assert.ok(i>0);b[i+5]=255;b[i+6]=255;assert.throws(()=>jpegFrame(b));await assert.rejects(normalizeJevImage(b));
});
test('remote normalizer is authenticated, bounded, hash-checked and has no local codec fallback',async()=>{
 const source=await jpeg(entry),output=await normalizeJevImage(source),hash=async b=>createHash('sha256').update(b).digest('hex');
 const env={JEV_NORMALIZER_URL:'https://normalizer.example/v1/normalize',JEV_NORMALIZER_TOKEN:'a'.repeat(40),JEV_NORMALIZER_TIMEOUT_MS:'5000'};
 let seen;
 const result=await normalizeRemoteQuery(source,env,async(url,init)=>{seen={url,init};return new Response(output,{headers:{'content-type':'image/jpeg','x-normalization-version':NORMALIZER_VERSION,'x-source-sha256':await hash(source),'x-output-sha256':await hash(output)}});});
 assert.equal(seen.url,env.JEV_NORMALIZER_URL);assert.equal(seen.init.redirect,'manual');assert.equal(seen.init.headers.Authorization,`Bearer ${env.JEV_NORMALIZER_TOKEN}`);assert.deepEqual([...result], [...output]);
 await assert.rejects(normalizeRemoteQuery(source,{...env,JEV_NORMALIZER_URL:''},async()=>{throw Error('must not call')}),/NORMALIZER_UNAVAILABLE/);
});
test('enforce confirms current top1 only and records known cost',async()=>fixture(async f=>{
 const out=await applyJev(baseline,f.bytes,f.env,winner);assert.equal(out.recognized,true);assert.equal(out.artifact_id,'a1');assert.equal(out.verifier.status,'confirmed');assert.equal(f.calls(),1);assert.equal(f.reads(),1);const s=await jevStatus(f.env);assert.equal(s.usage.attempts,1);assert.equal(s.usage.charged_microusd,400);assert.equal(s.active_leases,0);
}));
for(const [name,provider,reason] of [
 ['negative',()=>answer(.2),'pairwise_identity_not_confirmed'],
 ['below cutoff',()=>answer(.49999),'pairwise_identity_not_confirmed'],
 ['bad model',()=>answer(.9,{model:'wrong'}),'pairwise_verifier_unavailable'],
 ['bad provider',()=>answer(.9,{provider:'other'}),'pairwise_verifier_unavailable'],
 ['invalid score',()=>answer('0.9'),'pairwise_verifier_unavailable'],
 ['HTTP failure',()=>new Response('secret-image-body-error',{status:500}),'pairwise_verifier_unavailable'],
 ['malformed JSON',()=>new Response('{not json',{headers:{'content-type':'application/json'}}),'pairwise_verifier_unavailable'],
 ['bad MIME',()=>new Response('secret',{headers:{'content-type':'text/html'}}),'pairwise_verifier_unavailable'],
 ['oversize stream',()=>new Response('a'.repeat(131073),{headers:{'content-type':'application/json'}}),'pairwise_verifier_unavailable'],
 ['network exception',()=>{throw Error('leak-token-and-image-data');},'pairwise_verifier_unavailable'],
])test(`enforce ${name} clears identity, never retries or switches runner-up`,async()=>fixture(async f=>{
 let n=0;globalThis.fetch=async()=>{n++;return provider();};const out=await applyJev(baseline,f.bytes,f.env,winner);assert.equal(out.recognized,false);assert.equal(out.status,'uncertain');for(const k of ['artifact','artifact_id','source','decision_source'])assert.equal(out[k],null);assert.equal(out.reason,reason);assert.equal(n,1);assert.ok(!JSON.stringify(out).includes('secret'));assert.ok(!JSON.stringify(out).includes('leak-token'));assert.equal(out.candidates,baseline.candidates);
}));
test('cutoff exactly.5 confirms without rounding',async()=>fixture(async f=>{globalThis.fetch=async()=>answer(.5);assert.equal((await applyJev(baseline,f.bytes,f.env,winner)).recognized,true);}));
test('timeout is bounded even when fetch ignores AbortSignal; no retry; unknown cost held',async()=>fixture(async f=>{
 f.env.JEV_TIMEOUT_MS='100';let n=0;globalThis.fetch=async()=>{n++;return new Promise(()=>{});};const started=Date.now(),out=await applyJev(baseline,f.bytes,f.env,winner);assert.equal(out.recognized,false);assert.equal(out.reason,'pairwise_verifier_unavailable');assert.equal(n,1);assert.ok(Date.now()-started<4000);const s=await jevStatus(f.env);assert.equal(s.usage.charged_microusd,RESERVATION_MICROUSD);assert.equal(s.usage.unknown_cost_attempts,1);
}));
test('body streaming timeout also fails closed',async()=>{let n=0;const r=await verifyBody('{}','test',async()=>{n++;return new Response(new ReadableStream({start(c){c.enqueue(new TextEncoder().encode('{'));}}),{headers:{'content-type':'application/json'}});},50);assert.equal(r.ok,false);assert.equal(r.code,'TIMEOUT');assert.equal(n,1);});
test('off and rejected baselines skip storage, codec, budget and network',async()=>fixture(async f=>{
 assert.equal(await applyJev(baseline,null,{...f.env,JEV_MODE:'off'},winner),baseline);const rejected={...baseline,recognized:false};assert.equal(await applyJev(rejected,null,f.env,winner),rejected);assert.equal(f.reads(),0);assert.equal(f.calls(),0);assert.equal((await jevStatus(f.env)).usage.attempts,0);
}));
test('shadow preserves match on veto and outage',async()=>fixture(async f=>{for(const ok of [true,false]){globalThis.fetch=async()=>ok?answer(.1):new Response('',{status:503});const r=await applyJev(baseline,f.bytes,{...f.env,JEV_MODE:'shadow'},winner);assert.equal(r.recognized,true);assert.equal(r.artifact_id,'a1');assert.equal(r.verifier_shadow.would_recognize,false);}}));
test('limit, circuit, corrupt provenance, missingstorage, invalidimage and SQL outage never call provider',async()=>fixture(async f=>{
 for(const extra of [{JEV_DAILY_LIMIT:'0'},{JEV_DAILY_BUDGET_MICROUSD:'11999'},{JEV_MODE:'typo'},{OPENROUTER_API_KEY:''},{IMAGES:{get:async()=>null}},{IMAGES:{get:async()=>({size:f.bytes.length,arrayBuffer:async()=>new Uint8Array([1,2,3])})}},{DB:{prepare(){throw Error('database-secret');}}}]){const r=await applyJev(baseline,f.bytes,{...f.env,...extra},winner);assert.equal(r.recognized,false);assert.equal(r.verifier.status,'unavailable');}
 assert.equal((await applyJev(baseline,f.bytes,f.env,{...winner,reference:{...winner.reference,digest:'different'}})).recognized,false);assert.equal(f.calls(),0);
}));
test('atomic count/cost/concurrency/circuit tests and expiry survive across Worker isolates',async()=>{
 const db=database(),env={DB:db,JEV_MODE:'enforce',JEV_MAX_CONCURRENCY:'2',JEV_DAILY_LIMIT:'10',JEV_DAILY_BUDGET_MICROUSD:'36000'},c=jevConfig(env),now=Date.now();
 const leases=await Promise.all(Array.from({length:10},()=>reserveJev(env,c,now)));assert.equal(leases.filter(Boolean).length,2);
 await settleJev(env,leases[0],{ok:true,state:'confirmed',cost:400},10,now);assert.ok(await reserveJev(env,c,now));assert.equal(await reserveJev(env,c,now),null);
 db.sqlite.exec('DELETE FROM jev_attempts');for(let i=0;i<5;i++){const id=await reserveJev(env,{...c,dailyBudget:100000},now);assert.ok(id);await settleJev(env,id,{ok:false,state:'TIMEOUT',cost:null},1,now);}assert.equal(await reserveJev(env,c,now),null);assert.ok(await reserveJev(env,{...c,dailyBudget:100000},now+61000));
 db.sqlite.close();
});
test('actual recognize uses exact winning reference rather than first arbitrary view',async()=>fixture(async f=>{
 const second=release.entries.find(e=>e.artifact_id===entry.artifact_id&&e.digest!==entry.digest),third=release.entries.find(e=>e.artifact_id!==entry.artifact_id);assert.ok(second&&third);
 f.db.sqlite.prepare('INSERT INTO artifacts(id,name,name_key,external_object_id) VALUES(?,?,?,?)').run('a2',third.name,'two',third.artifact_id);
 f.db.sqlite.prepare(`INSERT INTO reference_images(id,artifact_id,filename,digest,r2_key,vector_id,status,signature,vector_json) VALUES('r0','a1','zero.jpg',?,'k0','v0','ready',?,?)`).run(second.digest,signature(baseEnv),JSON.stringify(second.vector));
 f.db.sqlite.prepare(`INSERT INTO reference_images(id,artifact_id,filename,digest,r2_key,vector_id,status,signature,vector_json) VALUES('r2','a2','two.jpg',?,'k2','v2','ready',?,?)`).run(third.digest,signature(baseEnv),JSON.stringify(third.vector));
 f.env.VECTORIZE={query:async()=>({matches:[{id:'v0',score:1,metadata:{artifact_id:'a1'}},{id:'v1',score:.9,metadata:{artifact_id:'a1'}},{id:'v2',score:.5,metadata:{artifact_id:'a2'}}]})};
 let jev=0;globalThis.fetch=async(url,init)=>{if(String(url).endsWith('/embeddings/models'))return Response.json({data:[{id:baseEnv.OPENROUTER_MODEL,architecture:{input_modalities:['image','text']}}]});if(String(url).endsWith('/chat/completions'))return Response.json({model:baseEnv.DESCRIPTION_MODEL,choices:[{finish_reason:'stop',message:{content:'A single painting is visible.'}}]});if(String(url).endsWith('/embeddings'))return Response.json({model:baseEnv.OPENROUTER_MODEL,data:[{embedding:normalize(entry.vector)}]});assert.equal(url,ENDPOINT);jev++;const body=JSON.parse(init.body);assert.equal(body.state[0],'IMAGE 1:');assert.equal(body.questions.same_physical_artwork.instructions,PROMPT);return answer(.8);};
 const r=await recognize(f.bytes,f.env);assert.equal(r.recognized,true);assert.equal(r.verifier.status,'confirmed');assert.equal(jev,1);assert.equal(f.reads(),1); // R2 fixture only accepts k1, while ORDERBYidfirst would select k0.
}));
test('Jev status endpoint remains behind admin authorization',async()=>{const db=database();const r=await worker.fetch(new Request('https://remote.example/api/admin/jev'),{...baseEnv,DB:db});assert.equal(r.status,403);db.sqlite.close();});
