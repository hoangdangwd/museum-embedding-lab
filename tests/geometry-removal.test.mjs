import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import worker from '../worker/index.js';
import {decideRecognition} from '../worker/recognition-policy.js';
import {signature} from '../worker/pipeline.js';
import {database,seed,envDefaults} from './fixtures.mjs';
const files=['worker/index.js','worker/recognition-policy.js','worker/integration.js','worker/catalog-release.js','integration/openapi.json','src/Recognition.jsx','wrangler.jsonc'];
test('geometry is absent from active runtime/config/schema/UI',async()=>{
 for(const file of files){const text=await readFile(file,'utf8');assert.doesNotMatch(text,/geometry|planar_geometry|PLANAR_GEOMETRY|artifactFamily|family\s*:/i,`${file} still contains removed geometry hook`);}
});
test('legacy geometry adapter and contract are removed from active paths',async()=>{
 await assert.rejects(()=>readFile('worker/geometry.js'));
 await assert.rejects(()=>readFile('integration/GEOMETRY.md'));
});
test('legacy auxiliary evidence cannot rescue, veto or switch a current embedding decision',()=>{
 const ranked=[{id:'a1',external_object_id:'stamp-em-thuy',score:.7},{id:'a2',external_object_id:'stamp-giong',score:.6}];
 for(const top of ['a1','a2'])for(const multiTarget of [false,true]){
  const geometry={mode:'enforce',status:'ready',pass:true,weakConflict:true,multiTarget,top:{artifact_id:top,inliers:100}};
  const decide=rows=>decideRecognition({ranked:rows,threshold:.8,margin:.05,geometry});
  assert.equal(decide(ranked).recognized,false);
  const matched=decide([{...ranked[0],score:.95},ranked[1]]);assert.equal(matched.recognized,true);assert.equal(matched.artifact.id,'a1');assert.equal(matched.source,'embedding');
 }
});
const token='test-geometry-removal-server-token-32-characters';
function form(){const bytes=new Uint8Array([255,216,255,192,0,17,8,2,128,2,128,3,1,17,0,2,17,1,3,17,1,255,218,0,12,3,1,0,2,17,3,17,0,63,0,1,255,217]);const f=new FormData();f.set('file',new Blob([bytes],{type:'image/jpeg'}),'fixture.jpg');return f;}
for(const path of ['/api/admin/query','/api/v1/recognitions'])test(`${path} has no geometry/family/timings and ignores removed env/service`,async()=>{
 const db=database(),env={...envDefaults,DB:db,JEV_MODE:'off',RECOGNITION_PIPELINE:'image-description-v1',RECOGNITION_SERVICE_TOKEN:token,RECOGNITION_GEOMETRY_MODE:'enforce'};
 seed(db,2,signature(env));for(let i=1;i<=2;i++)db.sqlite.prepare('UPDATE artifacts SET external_object_id=? WHERE id=?').run(i===1?'stamp-em-thuy':'stamp-giong',`a${i}`);
 Object.defineProperty(env,'PLANAR_GEOMETRY',{get(){throw Error('Removed binding was read');}});
 env.IMAGES={get(){throw Error('R2 must not be read when verifier off');}};
 let score=.95,description='A single painting with two figures is visible.',calls=0;
 env.VECTORIZE={query:async()=>({matches:[{id:'v1',score,metadata:{artifact_id:'a1'}},{id:'v2',score:.6,metadata:{artifact_id:'a2'}}]})};
 const original=globalThis.fetch;
 globalThis.fetch=async(url)=>{
  calls++;
  if(String(url).endsWith('/models'))return Response.json({data:[{id:env.OPENROUTER_MODEL,architecture:{input_modalities:['image','text']}}]});
  if(String(url).endsWith('/chat/completions'))return Response.json({model:'google/gemini-2.5-flash',choices:[{finish_reason:'stop',message:{content:description}}]});
  assert.ok(String(url).endsWith('/embeddings'));return Response.json({model:env.OPENROUTER_MODEL,data:[{embedding:[1,...Array(1535).fill(0)]}]});
 };
 try{
  for(const scenario of ['matched','rejected','semantic']){
   score=scenario==='rejected'?.7:.95;if(scenario==='semantic')description='Multiple artworks are visible in a museum setting.';
   const headers={'Authorization':`Bearer ${token}`,'Idempotency-Key':`removed-${scenario}`};
   const response=await worker.fetch(new Request('http://localhost'+path,{method:'POST',headers,body:form()}),env);
   assert.equal(response.status,200);const result=await response.json();
   assert.equal(result.status,scenario==='matched'?'matched':scenario==='rejected'?'no_match':'uncertain');
   for(const key of ['geometry','family'])assert.equal(key in result,false);
   assert.equal('geometry_ms' in result.timings,false);
   if(path.startsWith('/api/v1')){
    const before=calls,replay=await worker.fetch(new Request('http://localhost'+path,{method:'POST',headers,body:form()}),env);
    assert.equal(replay.headers.get('X-Idempotent-Replay'),'true');assert.deepEqual(await replay.json(),result);assert.equal(calls,before);
   }
  }
 }finally{globalThis.fetch=original;db.sqlite.close();}
});
