import test from 'node:test';
import assert from 'node:assert/strict';
import { artifactFamily, classifyScene, decideRecognition, HARD_NEGATIVE_TARGET } from '../worker/recognition-policy.js';
import { GEOMETRY_VERSION, geometryMode, validateGeometry, planarGeometry } from '../worker/geometry.js';
import { signature } from '../worker/pipeline.js';
import { database, seed, envDefaults } from './fixtures.mjs';

const planar = 'stamp-em-thuy', sculpture = 'stamp-hoang-hau-ngoc-truc';
const ranked = (external = planar, score = .9, second = .6) => [
  { id:'a1', external_object_id:external, score }, { id:'a2', external_object_id:'stamp-giong', score:second },
];
const decide = (r, extra = {}) => decideRecognition({ ranked:r, threshold:.8, margin:.05, ...extra });
const ref = { id:'ref1',artifact_id:'a1',digest:'a'.repeat(64) };
const match = (extra={}) => ({ reference_id:ref.id,reference_digest:ref.digest,roi_scope:'artifact_only_approved',inliers:30,match_count:40,reference_coverage:.4,query_coverage:.2,reprojection_error:1,projected_quad_valid:true,...extra });
const evidence = (matches = [match()]) => ({ version:GEOMETRY_VERSION,pipeline_signature:'sig',matches });
const geometry = (matches = [match()], refs = [ref], mode = 'enforce') => validateGeometry(evidence(matches),refs,'sig',mode);

test('semantic guard needs explicit scene-level plurality, not internal content or generic keywords',()=>{
  for (const text of [
    'A painting depicts two figures and another child in the foreground.',
    'A screen with several leaves, flowers and multiple panels.',
    'A sculpture has several arms and two faces.',
    'A painting depicts multiple artworks inside a gallery.',
    'Multiple paintings are depicted inside a single artwork.',
    'A painting is visible. No other artifacts are visible.',
    'A single statue is visible, not multiple artifacts.',
    'The label reads "Multiple artworks are visible".',
    'A museum interior with no multiple artifacts visible.',
    '', null,
  ]) assert.equal(classifyScene(text).reject,false,`${text}`);
  for (const text of [
    'Multiple artworks are visible in a museum setting. On the left, a portrait. To the right, a landscape.',
    'Three distinct artworks are visible. A bust is on the left and two paintings are on the right.',
    'The image displays multiple framed artworks on a wall.',
    'The image shows a gallery wall with several framed paintings.',
    'The image displays a museum exhibit featuring multiple artifacts.',
  ]) assert.equal(classifyScene(text).scene,'multi_artifact_scene',text);
  assert.equal(classifyScene('No clear artifact is visible. A blank wall fills the frame.').reject,true);
});

test('explicit primary target is preserved without a new provider prompt or invented scene count',()=>{
  for(const text of [
    'Two artworks are visible. The prominent artwork is a large rectangular painting. A smaller work is behind it.',
    'Multiple artworks are visible. The main statue is a seated wooden figure.',
    'The image shows three paintings. The largest painting is clearly visible in the center.',
  ]) assert.equal(classifyScene(text).scene,'single_dominant_artifact',text);
  assert.equal(classifyScene('A framed portrait of a girl.').scene,'unknown');
});

test('runtime family routing is an explicit external-ID allowlist, not a name or expected label',()=>{
  assert.equal(artifactFamily(planar),'planar');assert.equal(artifactFamily('stamp-binh-phong'),'planar');
  assert.equal(artifactFamily(sculpture),'sculpture');assert.equal(artifactFamily(HARD_NEGATIVE_TARGET),'sculpture');
  assert.equal(artifactFamily('a1'),'unknown');assert.equal(artifactFamily(undefined),'unknown');
  assert.equal(artifactFamily('Em Thúy'),'unknown');
});

test('strong quality-validated same-target planar geometry can rescue embedding below .75',()=>{
  const result=decide(ranked(planar,.7,.6),{geometry:geometry()});
  assert.equal(result.recognized,true);assert.equal(result.reason,'planar_geometry_rescue');
  assert.equal(result.source,'geometry');assert.equal(result.artifact.id,'a1');
  for(const mode of ['shadow','off']) assert.equal(decide(ranked(planar,.7,.6),{geometry:{...geometry(),mode}}).recognized,false);
});

test('sculptures and unknown families ignore planar geometry and require no hard-negative bank',()=>{
  for(const id of [sculpture,HARD_NEGATIVE_TARGET,'custom-id']) {
    assert.equal(decide(ranked(id),{geometry:{...geometry(),multiTarget:true}}).recognized,true);
    assert.equal(decide(ranked(id,.7,.6),{geometry:geometry()}).recognized,false);
  }
  assert.equal(decide(ranked(sculpture),{hardNegativeTriggered:true}).recognized,true);
  const rejected=decide(ranked(HARD_NEGATIVE_TARGET),{hardNegativeTriggered:true});
  assert.equal(rejected.reason,'hard_negative_conflict');assert.equal(rejected.artifact,null);
});

test('multi-target and cross-artifact conflicts never silently select the runner-up',()=>{
  assert.equal(decide(ranked(),{geometry:{...geometry(),multiTarget:true}}).reason,'multiple_geometric_targets');
  const other={...geometry(),top:{artifact_id:'a2',inliers:30}};
  for(const score of [.7,.95]) {
    const r=decide(ranked(planar,score,.6),{geometry:other});
    assert.equal(r.reason,'geometry_conflict');assert.equal(r.artifact,null);
  }
  assert.equal(decide(ranked(),{geometry:{...other,pass:false,weakConflict:true}}).reason,'geometry_conflict');
  assert.equal(decide(ranked(),{geometry:{...other,status:'unavailable'}}).recognized,true);
  assert.equal(decide(ranked().slice(0,1),{geometry:geometry()}).recognized,false);
});

test('geometry quality gates reject inlier count alone, clustered points, bad projection and ratio',()=>{
  for(const extra of [
    {inliers:20}, {reference_coverage:.05}, {query_coverage:.001}, {projected_quad_valid:false},
    {reprojection_error:4}, {match_count:100},
  ]) assert.equal(geometry([match(extra)]).pass,false,JSON.stringify(extra));
  for(const extra of [
    {reference_digest:'wrong'}, {roi_scope:'whole_image'}, {reference_id:'unknown'},
    {inliers:NaN}, {inliers:-1}, {match_count:5001}, {reference_coverage:2}, {reprojection_error:Infinity},
  ]) assert.throws(()=>geometry([match(extra)]));
  assert.throws(()=>validateGeometry({...evidence(),pipeline_signature:'old'},[ref],'sig','enforce'));
  assert.throws(()=>validateGeometry({...evidence(),version:'other'},[ref],'sig','enforce'));
});

test('geometry max-aggregates views of one artifact instead of inventing a second target',()=>{
  const r2={...ref,id:'ref2'},r3={...ref,id:'ref3',artifact_id:'a2'};
  const result=geometry([match(),match({reference_id:'ref2',inliers:28}),match({reference_id:'ref3',inliers:10,match_count:20})],[ref,r2,r3]);
  assert.equal(result.ranking.length,2);assert.equal(result.top.inliers,30);assert.equal(result.multiTarget,true);assert.equal(result.pass,false);
});

test('geometry config fails before use without a trusted service and disabled path never reads storage',async()=>{
  assert.equal(geometryMode({}),'off');
  for(const mode of ['broken','shadow','enforce']) assert.throws(()=>geometryMode({RECOGNITION_GEOMETRY_MODE:mode}));
  assert.deepEqual(await planarGeometry(null,{},'off'),{mode:'off',status:'off'});
});

test('trusted geometry binding receives only current ready planar references and validates its response',async()=>{
  const db=database(),env={...envDefaults,DB:db};seed(db,3,signature(env));
  db.sqlite.prepare('UPDATE artifacts SET external_object_id=? WHERE id=?').run(planar,'a1');
  db.sqlite.prepare('UPDATE artifacts SET external_object_id=? WHERE id=?').run(sculpture,'a2');
  db.sqlite.prepare('UPDATE artifacts SET external_object_id=? WHERE id=?').run('stamp-giong','a3');
  db.sqlite.prepare("UPDATE reference_images SET signature='old' WHERE id='ref3'").run();
  let calls=0;
  env.PLANAR_GEOMETRY={fetch:async request=>{
    calls++;const form=await request.formData(),refs=JSON.parse(form.get('references'));
    assert.equal(refs.length,1);assert.equal(refs[0].artifact_id,'a1');assert.equal(form.get('pipeline_signature'),signature(env));
    return Response.json({version:GEOMETRY_VERSION,pipeline_signature:signature(env),matches:[match({reference_id:'ref1',reference_digest:'digest1'})]});
  }};
  try {
    assert.equal(geometryMode({...env,RECOGNITION_GEOMETRY_MODE:'shadow'}),'shadow');
    const result=await planarGeometry(new Uint8Array([1]).buffer,env,'shadow');
    assert.equal(result.status,'ready');assert.equal(result.pass,true);assert.equal(calls,1);
    env.PLANAR_GEOMETRY.fetch=async()=>Response.json({});
    assert.equal((await planarGeometry(new Uint8Array([1]).buffer,env,'enforce')).status,'unavailable');
  } finally {db.sqlite.close();}
});
