import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyScene, decideRecognition, HARD_NEGATIVE_TARGET, isHardNegativeTarget } from '../worker/recognition-policy.js';

const painting = 'stamp-em-thuy', sculpture = 'stamp-hoang-hau-ngoc-truc';
const ranked = (external = painting, score = .9, second = .6) => [
  { id:'a1', external_object_id:external, score }, { id:'a2', external_object_id:'stamp-giong', score:second },
];
const decide = (r, extra = {}) => decideRecognition({ ranked:r, threshold:.8, margin:.05, ...extra });

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

test('all artifacts use the same raw embedding score/margin without a rescue path',()=>{
  for(const target of [painting,sculpture,HARD_NEGATIVE_TARGET,'custom-id']) {
    const pass=decide(ranked(target));assert.equal(pass.recognized,true);assert.equal(pass.source,'embedding');assert.equal(pass.artifact.id,'a1');
    const fail=decide(ranked(target,.79999,.6));assert.equal(fail.recognized,false);assert.equal(fail.artifact,null);assert.equal(fail.reason,'below_threshold');
    assert.equal(decide(ranked(target,.9,.89)).reason,'insufficient_margin');
    assert.equal(decide(ranked(target).slice(0,1)).recognized,false);
  }
  assert.equal(decide([]).recognized,false);
  assert.equal(decide(ranked(painting,.8,.75)).recognized,true);
});

test('hard negatives veto only their explicitly approved targets and never select runner-up',()=>{
  for(const target of [sculpture,HARD_NEGATIVE_TARGET,'stamp-canh-cua-cham-rong','stamp-hai-thieu-nu-em-be','stamp-em-thuy']) {
    assert.equal(isHardNegativeTarget(target),true);
    const rejected=decide(ranked(target),{hardNegativeTriggered:true});
    assert.equal(rejected.reason,'hard_negative_conflict');assert.equal(rejected.artifact,null);assert.equal(rejected.source,null);
  }
  assert.equal(isHardNegativeTarget(undefined),false);
  for(const target of ['stamp-giong','stamp-binh-phong','custom-id']) {
    assert.equal(isHardNegativeTarget(target),false);
    assert.equal(decide(ranked(target),{hardNegativeTriggered:true}).recognized,true);
  }
});
