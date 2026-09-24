import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rank, normalize, summarize, calibrate, loadManifest } from '../scripts/recognition-eval.mjs';

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
