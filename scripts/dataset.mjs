// Local-only dataset discovery/validation. Never calls a provider or writes remote data.
import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { prepareImages } from './seed-stamps.mjs';
import { signature } from '../worker/pipeline.js';

const defaultRoot = fileURLToPath(new URL('../data/', import.meta.url));
const imageExtensions = new Set(['.jpg', '.jpeg', '.png', '.webp']);
const splits = ['calibration', 'final'];
const negativeLabels = { _unknown: 'out_of_catalog', _ambiguous: 'ambiguous', _low_quality: 'low_quality' };
const hash = bytes => createHash('sha256').update(bytes).digest('hex');

async function imageFiles(root, prefix = '') {
  let items;
  try { items = await readdir(join(root, prefix), { withFileTypes: true }); }
  catch (error) { if (error.code === 'ENOENT') return []; throw error; }
  const files = [];
  for (const item of items.sort((a, b) => a.name.localeCompare(b.name, 'en'))) {
    if (item.name.startsWith('.')) continue;
    const file = prefix ? `${prefix}/${item.name}` : item.name;
    if (item.isSymbolicLink()) throw Error(`Không dùng symlink trong dataset: ${file}`);
    if (item.isDirectory()) files.push(...await imageFiles(root, file));
    else if (imageExtensions.has(extname(item.name).toLowerCase())) files.push(file);
  }
  return files;
}

export async function scanDataset(root = defaultRoot) {
  const catalog = JSON.parse(await readFile(join(root, 'artifacts.json'), 'utf8'));
  const ids = new Set();
  for (const artifact of catalog) {
    if (!/^[-a-z0-9]+$/.test(artifact.id) || ids.has(artifact.id) || typeof artifact.name !== 'string' || !artifact.name.trim()) throw Error(`Mã/tên bảo vật không hợp lệ hoặc bị trùng: ${artifact.id}`);
    ids.add(artifact.id);
  }
  const entries = [], digests = new Map();
  for (const partition of ['references', 'test']) {
    for (const file of await imageFiles(join(root, partition))) {
      const [id, split, scenario, ...tail] = file.split('/');
      let entry;
      if (partition === 'references') {
        if (!ids.has(id) || !split) throw Error(`Ảnh tham chiếu phải ở references/<mã-bảo-vật>/: ${file}`);
        entry = { file: `${partition}/${file}`, partition, expected: id };
      } else {
        if (!splits.includes(split)) throw Error(`Ảnh test phải có thư mục calibration hoặc final: ${file}`);
        if (ids.has(id)) {
          if (!['known_clean', 'known_clutter'].includes(scenario) || !tail.length) throw Error(`Ảnh test phải ở test/<mã>/${split}/<known_clean|known_clutter>/: ${file}`);
          entry = { file: `${partition}/${file}`, partition: split, expected: id, scenario };
        } else {
          if (!negativeLabels[id] || !scenario) throw Error(`Nhãn test không hợp lệ: ${file}`);
          entry = { file: `${partition}/${file}`, partition: split, expected: id, scenario: negativeLabels[id] };
        }
      }
      const bytes = await readFile(join(root, entry.file));
      if (!bytes.length || bytes.length > 15 * 1024 * 1024) throw Error(`Ảnh rỗng hoặc lớn hơn 15 MB: ${entry.file}`);
      entry.sha256 = hash(bytes);
      if (digests.has(entry.sha256)) throw Error(`Ảnh trùng (không dùng cùng ảnh cho reference/test hoặc calibration/final): ${digests.get(entry.sha256)} = ${entry.file}`);
      digests.set(entry.sha256, entry.file);
      entries.push(entry);
    }
  }
  // Files are derived from reference folders, never from test/ or the legacy Stamp/.
  const updated = catalog.map(artifact => ({ ...artifact, files: entries.filter(entry => entry.partition === 'references' && entry.expected === artifact.id).map(entry => entry.file) }));
  for (const entry of entries.filter(entry => entry.partition !== 'references' && ids.has(entry.expected))) {
    if (!updated.find(artifact => artifact.id === entry.expected).files.length) throw Error(`Ảnh test không có bảo vật tham chiếu: ${entry.file}`);
  }
  return { catalog: updated, entries, summary: {
    artifacts: catalog.length,
    references: entries.filter(entry => entry.partition === 'references').length,
    calibration: entries.filter(entry => entry.partition === 'calibration').length,
    final: entries.filter(entry => entry.partition === 'final').length,
    missing: updated.filter(artifact => !artifact.files.length).map(artifact => artifact.id),
  } };
}

export async function prepareEvaluation(root = defaultRoot, output = join(root, 'evaluation'), prepare = prepareImages) {
  const dataset = await scanDataset(root);
  if (dataset.summary.calibration === 0 || dataset.summary.final === 0 || dataset.catalog.filter(item => item.files.length).length < 2) throw Error('Cần ít nhất hai bảo vật tham chiếu và ảnh test riêng trong cả calibration và final. Chưa gọi model/ghi manifest.');
  const prepared = await prepare(dataset.entries, pathToFileURL(resolve(root) + '/'));
  const entries = [], digests = new Map();
  for (const source of prepared) {
    const digest = hash(source.bytes);
    if (digests.has(digest)) throw Error(`Ảnh trùng sau chuẩn hóa JPEG: ${digests.get(digest)} = ${source.file}`);
    digests.set(digest, source.file);
    // Hash filenames avoid collisions between e.g. photo.png and photo.jpg.
    const file = `${source.partition}/${source.expected}/${digest}.jpg`;
    entries.push({ file, partition: source.partition, expected: source.expected, ...(source.scenario ? { scenario: source.scenario } : {}), sha256: digest });
  }
  // Match the configured production pipeline, including EMBEDDING_VERSION=1.
  const env = { RECOGNITION_PIPELINE: 'image-description-v1', OPENROUTER_MODEL: 'google/gemini-embedding-2', DESCRIPTION_MODEL: 'google/gemini-2.5-flash', EMBEDDING_VERSION: '1', PREPROCESS_VERSION: 'rgb-exif-white-jpeg95-max1600-v1' };
  const manifest = { version: 1, model: env.OPENROUTER_MODEL, dimensions: 1536, signature: signature(env), pipeline: {
    mode: env.RECOGNITION_PIPELINE, description_model: env.DESCRIPTION_MODEL, embedding_version: env.EMBEDDING_VERSION, preprocess_version: env.PREPROCESS_VERSION,
  }, entries };
  for (const [index, entry] of entries.entries()) {
    const target = join(output, entry.file);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, prepared[index].bytes);
  }
  await writeFile(join(output, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  return { ...dataset.summary, manifest: join(output, 'manifest.json') };
}

async function main() {
  const [command, ...flags] = process.argv.slice(2);
  if (command === 'scan' && flags.every(flag => flag === '--write')) {
    const dataset = await scanDataset();
    if (flags.includes('--write')) await writeFile(join(defaultRoot, 'artifacts.json'), JSON.stringify(dataset.catalog, null, 2) + '\n');
    console.log(JSON.stringify(dataset.summary, null, 2));
  } else if (command === 'prepare' && !flags.length) console.log(JSON.stringify(await prepareEvaluation(), null, 2));
  else throw Error('Usage: node scripts/dataset.mjs scan [--write] | prepare (local only; no paid calls)');
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main().catch(error => { console.error(error.message); process.exitCode = 1; });
