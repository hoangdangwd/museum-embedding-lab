import test from 'node:test';
import assert from 'node:assert/strict';
import {buildIndex, rankVector, evaluateCalibration, measure} from '../scripts/cached-retrieval-study.mjs';

const refs = [{partition:'references',expected:'a',sha256:'a1'}, {partition:'references',expected:'a',sha256:'a2'}, {partition:'references',expected:'b',sha256:'b1'}];
const cache = {signature:'s',vectors:{a1:[1,0],a2:[.8,.6],b1:[0,1],q:[1,0]}};
test('retrieval aggregation computes max, top-k fallback and normalized centroid',()=>{
  const index=buildIndex(refs,cache,2);
  assert.equal(rankVector([1,0],index,'max').score,1);
  assert.equal(rankVector([1,0],index,'top2_mean').score,.9);
  assert.equal(rankVector([1,0],index,'top3_mean').score,.9);
  assert.ok(Math.abs(rankVector([1,0],index,'centroid').score-1.8/Math.hypot(1.8,.6))<1e-12);
});
test('study ignores final vector even if missing and never indexes calibration',()=>{
  const manifest={signature:'s',dimensions:2,entries:[...refs,{partition:'calibration',expected:'a',scenario:'known_clean',sha256:'q',file:'calibration/a.jpg'}, {partition:'final',sha256:'missing'}]};
  assert.equal(evaluateCalibration(manifest,cache,'max').length,1);
  assert.throws(()=>buildIndex([manifest.entries[3]],cache,2),/Only references/);
  assert.throws(()=>evaluateCalibration({...manifest,signature:'different'},cache,'max'),/signature/);
});
test('ambiguous and wrong-artifact additions both reduce precision',()=>{
  const rows=[{expected:'a',predicted:'a',scenario:'known_clean',score:.9,margin:.2},
    {expected:'b',predicted:'a',scenario:'known_clutter',score:.9,margin:.2},
    {expected:'_ambiguous',predicted:'a',scenario:'ambiguous',score:.9,margin:.2}];
  const s=measure(rows,.8,.1);
  assert.equal(s.correct,1); assert.equal(s.wrong_artifact_accept,1);
  assert.equal(s.false_acceptance.ambiguous.count,1); assert.equal(s.precision,1/3);
  assert.equal(s.macro_recall,.5);
});
