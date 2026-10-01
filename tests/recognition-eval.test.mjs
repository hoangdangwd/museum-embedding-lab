import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rank, normalize, summarize, calibrate, loadManifest, embed } from '../scripts/recognition-eval.mjs';
import { signature, DESCRIPTION_PROMPT } from '../worker/pipeline.js';

test('rank supports max and top2 mean', () => {
  const scores = [
    { artifact: 'a', file: 'a/1.jpg', score: .95 },
    { artifact: 'a', file: 'a/2.jpg', score: .55 },
    { artifact: 'b', file: 'b/1.jpg', score: .80 },
  ];
  assert.equal(rank(scores, 'max').predicted, 'a');
  assert.equal(rank(scores, 'max').score, .95);
  assert.equal(rank(scores, 'top2_mean').predicted, 'b');
  assert.equal(rank(scores, 'top2_mean').score, .80);
  assert.ok(Math.abs(rank(scores, 'top2_mean').margin - .05) < 1e-10);
});

test('normalization rejects invalid vectors', () => {
  assert.deepEqual(normalize([3, 4], 2), [.6, .8]);
  assert.throws(() => normalize([0, 0], 2), /Zero vector/);
  assert.throws(() => normalize([1], 2), /Invalid vector/);
});

test('calibration excludes unknown and ambiguous false accepts', () => {
  const rows = {
    max: [
      { scenario: 'known_clean', expected: 'a', predicted: 'a', score: .91, margin: .2 },
      { scenario: 'out_of_catalog', expected: '_unknown', predicted: 'a', score: .91, margin: .2 },
      { scenario: 'ambiguous', expected: '_ambiguous', predicted: 'a', score: .91, margin: .2 },
    ],
    top2_mean: [
      { scenario: 'known_clean', expected: 'a', predicted: 'a', score: .81, margin: .2 },
      { scenario: 'out_of_catalog', expected: '_unknown', predicted: 'a', score: .4, margin: .01 },
      { scenario: 'ambiguous', expected: '_ambiguous', predicted: 'a', score: .4, margin: .01 },
    ],
  };
  assert.equal(calibrate(rows).selected.aggregation, 'top2_mean');
  assert.equal(summarize(rows.top2_mean, .8, .05).false_acceptance_unknown.count, 0);
});

test('manifest validates JPEGs and duplicate digests', async () => {
  const root = await mkdtemp(join(tmpdir(), 'museum-eval-'));
  await mkdir(join(root, 'references', 'a'), { recursive: true });
  await mkdir(join(root, 'references', 'b'), { recursive: true });
  await mkdir(join(root, 'calibration', 'a'), { recursive: true });
  await mkdir(join(root, 'final', 'a'), { recursive: true });
  const files = ['references/a/1.jpg', 'references/b/1.jpg', 'calibration/a/1.jpg', 'final/a/1.jpg'];
  const entries = [];
  for (const [index, file] of files.entries()) {
    const bytes = Buffer.from([0xff, 0xd8, index, 0xff, 0xd9]);
    await writeFile(join(root, file), bytes);
    const digest = createHash('sha256').update(bytes).digest('hex');
    entries.push({ file, partition: file.split('/')[0], expected: file.includes('/b/') ? 'b' : 'a', ...(file.startsWith('references/') ? {} : { scenario: 'known_clean' }), sha256: digest });
  }
  await writeFile(join(root, 'manifest.json'), JSON.stringify({ version: 1, model: 'test', dimensions: 2, signature: 'test', entries }));
  await assert.doesNotReject(loadManifest(join(root, 'manifest.json')));
});

test('offline description evaluation uses the production prompt and joint input, persists completed descriptions and rejects signature drift',async()=>{
  const root=await mkdtemp(join(tmpdir(),'museum-description-eval-'));
  const path=join(root,'query.jpg'); await writeFile(path,Buffer.from([255,216,255,217]));
  const env={RECOGNITION_PIPELINE:'image-description-v1',OPENROUTER_MODEL:'google/gemini-embedding-2',DESCRIPTION_MODEL:'google/gemini-2.5-flash',EMBEDDING_VERSION:'2',PREPROCESS_VERSION:'test'};
  const manifest={model:env.OPENROUTER_MODEL,dimensions:1536,signature:signature(env),pipeline:{mode:env.RECOGNITION_PIPELINE,description_model:env.DESCRIPTION_MODEL,embedding_version:'2',preprocess_version:'test'},entries:[{sha256:'query-hash',path}]};
  let descriptions=0,embeddings=0,fail=true;
  const original=process.env.OPENROUTER_API_KEY; process.env.OPENROUTER_API_KEY='offline-test-key';
  const request=async(url,options)=>{
    const body=JSON.parse(options.body);
    if(String(url).endsWith('/chat/completions')){
      descriptions++; assert.equal(body.messages[0].content,DESCRIPTION_PROMPT);
      return Response.json({model:env.DESCRIPTION_MODEL,choices:[{finish_reason:'stop',message:{content:'A printed stamp depicting a seated girl.'}}]});
    }
    embeddings++; assert.deepEqual(body.input[0].content.map(part=>part.type),['text','image_url']);
    if(fail)return new Response('',{status:502});
    return Response.json({model:env.OPENROUTER_MODEL,data:[{embedding:[1,...Array(1535).fill(0)]}]});
  };
  try {
    await assert.rejects(embed(manifest,join(root,'cache.json'),request),/502/);
    fail=false; await embed(manifest,join(root,'cache.json'),request);
    assert.equal(descriptions,1); assert.equal(embeddings,2);
    await assert.rejects(embed({...manifest,signature:'stale'},join(root,'other.json'),request),/signature mismatch/);
  } finally { if(original===undefined)delete process.env.OPENROUTER_API_KEY;else process.env.OPENROUTER_API_KEY=original; }
});
