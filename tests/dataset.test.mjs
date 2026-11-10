import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { scanDataset, prepareEvaluation } from '../scripts/dataset.mjs';
import { loadManifest } from '../scripts/recognition-eval.mjs';
import { signature } from '../worker/pipeline.js';

async function fixture(action) {
  const root = await mkdtemp(join(tmpdir(), 'museum-dataset-'));
  let sequence = 0;
  const add = async (file, bytes = Buffer.from([255, 216, sequence++, 255, 217])) => {
    await mkdir(dirname(join(root, file)), { recursive: true });
    await writeFile(join(root, file), bytes);
    return bytes;
  };
  await add('artifacts.json', JSON.stringify([{ id: 'stamp-a', name: 'A', files: ['old-path.jpg'] }, { id: 'stamp-b', name: 'B', files: [] }]));
  try { await action({ root, add }); } finally { await rm(root, { recursive: true, force: true }); }
}

test('folder discovery handles nested views/extensions and ignores tests/legacy in reference mapping', () => fixture(async ({ root, add }) => {
  await add('references/stamp-a/front/a.JPG');
  await add('references/stamp-a/back/b.png');
  await add('references/stamp-b/b.webp');
  await add('test/stamp-a/calibration/known_clean/q.jpeg');
  await add('test/stamp-b/final/known_clutter/q.jpg');
  await add('test/_unknown/final/q.jpg');
  await add('test/stamp-a/final/known_clean/.gitkeep', '');
  await add('Stamp/legacy.jpg');
  const result = await scanDataset(root);
  assert.deepEqual(result.summary, { artifacts: 2, references: 3, calibration: 1, final: 2, missing: [] });
  assert.equal(result.catalog[0].files.length, 2);
  assert.ok(result.catalog.flatMap(item => item.files).every(file => file.startsWith('references/')));
  assert.equal(JSON.parse(await readFile(join(root, 'artifacts.json'), 'utf8'))[0].files[0], 'old-path.jpg');
}));

test('identical reference/test images are rejected before any model call', () => fixture(async ({ root, add }) => {
  const bytes = await add('references/stamp-a/a.jpg');
  await add('test/stamp-a/final/known_clean/copy.jpg', bytes);
  await assert.rejects(scanDataset(root), /Ảnh trùng/);
}));

test('same source cannot leak between calibration and final', () => fixture(async ({ root, add }) => {
  await add('references/stamp-a/a.jpg');
  const bytes = await add('test/stamp-a/calibration/known_clutter/q.jpg');
  await add('test/stamp-a/final/known_clean/q.jpg', bytes);
  await assert.rejects(scanDataset(root), /Ảnh trùng/);
}));

test('invalid folders/labels cannot silently enter the catalog', () => fixture(async ({ root, add }) => {
  await add('references/typo/a.jpg');
  await assert.rejects(scanDataset(root), /Ảnh tham chiếu/);
  await rm(join(root, 'references'), { recursive: true });
  await add('test/stamp-a/q.jpg');
  await assert.rejects(scanDataset(root), /calibration hoặc final/);
}));

test('known test labels need a reference, empty folders remain valid during preparation', () => fixture(async ({ root, add }) => {
  const empty = await scanDataset(root);
  assert.deepEqual(empty.summary.missing, ['stamp-a', 'stamp-b']);
  await add('test/stamp-a/final/known_clean/q.jpg');
  await assert.rejects(scanDataset(root), /không có bảo vật tham chiếu/);
}));

test('evaluation preparation refuses missing test partitions before JPEG preprocessing', () => fixture(async ({ root, add }) => {
  await add('references/stamp-a/a.jpg');
  await add('references/stamp-b/b.jpg');
  await assert.rejects(prepareEvaluation(root, join(root, 'evaluation'), () => { throw Error('must not run'); }), /Cần ít nhất/);
}));

test('evaluation preparation produces a valid manifest matching production signature without provider calls', () => fixture(async ({ root, add }) => {
  await add('references/stamp-a/a.jpg');
  await add('references/stamp-b/b.jpg');
  await add('test/stamp-a/calibration/known_clean/q.jpg');
  await add('test/stamp-b/final/known_clutter/q.jpg');
  const prepare = entries => Promise.all(entries.map(async entry => ({ ...entry, bytes: await readFile(join(root, entry.file)) })));
  const output = join(root, 'evaluation');
  await prepareEvaluation(root, output, prepare);
  const manifest = await loadManifest(join(output, 'manifest.json'));
  assert.equal(manifest.entries.length, 4);
  assert.equal(manifest.signature, signature({ EMBEDDING_VERSION: '1' }));
  assert.equal(manifest.entries.find(entry => entry.partition === 'final').expected, 'stamp-b');
}));

test('evaluation preparation also rejects duplicate normalized JPEGs', () => fixture(async ({ root, add }) => {
  await add('references/stamp-a/a.jpg');
  await add('references/stamp-b/b.jpg');
  await add('test/stamp-a/calibration/known_clean/q.jpg');
  await add('test/stamp-b/final/known_clean/q.jpg');
  await assert.rejects(prepareEvaluation(root, join(root, 'evaluation'), async entries => entries.map(entry => ({ ...entry, bytes: Buffer.from([255, 216, 255, 217]) }))), /trùng sau chuẩn hóa/);
}));
