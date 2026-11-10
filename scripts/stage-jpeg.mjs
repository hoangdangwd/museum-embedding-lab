// Offline staging encoder: uses the application's jpeg(), never uploads or seeds.
import { createHash } from 'node:crypto';
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve, relative, isAbsolute, extname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
export function confined(root, file) {
  if (typeof file !== 'string' || isAbsolute(file) || file.includes('\\') || file.includes(':') || file.split('/').some(part => !part || part === '.' || part === '..')) throw Error('Unsafe staging path');
  const path = resolve(root, file);
  if (relative(root, path).startsWith('..')) throw Error('Staging path escape');
  return path;
}

export function validateManifest(manifest) {
  if (!manifest.owner_staging_approved || manifest.official_partitions_applied !== false || manifest.provider_calls !== 0 || !Array.isArray(manifest.entries)) throw Error('Need approved successful offline decode manifest');
  const counts = { references: 0, calibration: 0, final: 0 };
  const ids = new Set(), files = new Set();
  for (const entry of manifest.entries) {
    if (entry.decode_status !== 'ok' || !Object.hasOwn(counts, entry.proposed_role) || !/^R[0-9]+$/.test(entry.review_id)) throw Error('Invalid decoded staging entry');
    if (ids.has(entry.review_id) || files.has(entry.source_file)) throw Error('Duplicate staging source or ID');
    if ((entry.camera_model === '22041216G') !== (entry.proposed_role === 'final')) throw Error('Holdout device leakage');
    if (entry.proposed_role === 'references' && !entry.reference_selection_owner_approved) throw Error('Unapproved reference');
    if (entry.partition != null || entry.scenario != null || entry.approved_artifact_id != null) throw Error('Staging cannot apply labels or partitions');
    counts[entry.proposed_role]++; ids.add(entry.review_id); files.add(entry.source_file);
  }
  if (counts.references !== 35 || counts.calibration !== 564 || counts.final !== 183) throw Error('Approved selection count mismatch');
  return counts;
}

async function main() {
  const flags = process.argv.slice(2);
  if (flags.some(flag => flag !== '--resume' && !flag.startsWith('--stage='))) throw Error('Usage: node scripts/stage-jpeg.mjs [--stage=data/staging/drive-normalized-v1] [--resume]');
  const repo = fileURLToPath(new URL('../', import.meta.url));
  const stage = resolve(flags.find(flag => flag.startsWith('--stage='))?.slice(8) || 'data/staging/drive-normalized-v1');
  const parent = resolve(repo, 'data/staging');
  if (relative(parent, stage).startsWith('..') || stage === parent) throw Error('Encoder writes only a dataset directory within data/staging/');
  const manifest = JSON.parse(await readFile(resolve(stage, 'decode-manifest.json'), 'utf8'));
  validateManifest(manifest);
  const sources = new Map(await Promise.all(['media.js', 'camera-zoom.js'].map(async file => [`/src/${file}`, await readFile(resolve(repo, 'src', file), 'utf8')])));
  const config = { version: 'shared-browser-jpeg-staging-v1', decode_manifest_sha256: hash(await readFile(resolve(stage, 'decode-manifest.json'))),
    media_js_sha256: hash(sources.get('/src/media.js')), camera_zoom_js_sha256: hash(sources.get('/src/camera-zoom.js')),
    source_policy: manifest.version, official_partitions_applied: false, provider_calls: 0 };
  const runFile = resolve(stage, 'jpeg-run.json');
  let existing;
  try { existing = JSON.parse(await readFile(runFile, 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (existing && !flags.includes('--resume')) throw Error('JPEG run exists; choose --resume, do not overwrite decisions');
  const cached = new Map();
  if (existing) {
    for (const [key, value] of Object.entries(config)) if (existing[key] !== value) throw Error(`JPEG resume configuration drift: ${key}`);
    let log = '';
    try { log = await readFile(resolve(stage, 'jpeg-log.jsonl'), 'utf8'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    for (const line of log.split('\n')) {
      try { const row = JSON.parse(line); if (row.jpeg_status === 'ok') cached.set(row.review_id, row); } catch { /* Interrupted final row is not completion. */ }
    }
  }
  const { chromium } = await import('@playwright/test');
  const browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH } : {}) });
  const version = browser.version();
  const rows = [];
  try {
    if (existing && existing.chromium_version !== version) throw Error('Chromium version changed; use a new staging run for reproducibility');
    await writeFile(runFile, JSON.stringify({ ...config, chromium_version: version }, null, 2) + '\n');
    const page = await browser.newPage();
    await page.route('**/*', route => {
      const url = new URL(route.request().url());
      if (url.origin !== 'http://offline-staging.local') return route.abort();
      if (url.pathname === '/') return route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Offline staging</title>' });
      if (!sources.has(url.pathname)) return route.abort();
      return route.fulfill({ contentType: 'text/javascript', body: sources.get(url.pathname) });
    });
    await page.goto('http://offline-staging.local/');
    for (const entry of manifest.entries) {
      let row = { ...entry };
      try {
        if (!['references', 'calibration', 'final'].includes(entry.proposed_role) || !/^R[0-9]+$/.test(entry.review_id)) throw Error('Invalid staging role or ID');
        if (entry.holdout_device_reserved && entry.proposed_role !== 'final') throw Error('Holdout device leakage');
        const original = confined(manifest.originals_root, entry.source_file);
        if (hash(await readFile(original)) !== entry.source_sha256) throw Error('Original changed since approval');
        const inputFile = entry.input_kind === 'original_jpeg' ? original : confined(stage, entry.input_file);
        const bytes = await readFile(inputFile);
        if (hash(bytes) !== entry.input_sha256) throw Error('Input hash mismatch');
        const previous = cached.get(entry.review_id);
        if (previous?.source_sha256 === entry.source_sha256) {
          const previousBytes = await readFile(confined(stage, previous.jpeg_file)).catch(() => null);
          if (previousBytes && hash(previousBytes) === previous.normalized_sha256) row = { ...previous, resume_verified: true };
          else row = await encode(entry, bytes, inputFile, page, stage);
        } else row = await encode(entry, bytes, inputFile, page, stage);
      } catch (error) { row.jpeg_status = 'error'; row.jpeg_error = error.message; }
      rows.push(row);
      await appendFile(resolve(stage, 'jpeg-log.jsonl'), JSON.stringify(row) + '\n');
      if (rows.length % 50 === 0 || row.jpeg_status !== 'ok' || rows.length === manifest.entries.length) console.log(JSON.stringify({ encoded: rows.length, total: manifest.entries.length, errors: rows.filter(item => item.jpeg_status !== 'ok').length }));
    }
  } finally { await browser.close(); }
  const groups = new Map();
  for (const row of rows.filter(row => row.jpeg_status === 'ok')) {
    if (!groups.has(row.normalized_sha256)) groups.set(row.normalized_sha256, []);
    groups.get(row.normalized_sha256).push({ review_id: row.review_id, source_file: row.source_file, proposed_role: row.proposed_role });
  }
  const duplicates = [...groups.values()].filter(group => group.length > 1);
  const summary = { entries: rows.length, successful: rows.filter(row => row.jpeg_status === 'ok').length, errors: rows.filter(row => row.jpeg_status !== 'ok').length,
    jpeg_bytes: rows.reduce((sum, row) => sum + (row.jpeg_bytes || 0), 0), duplicate_normalized_groups: duplicates,
    cross_role_duplicate_groups: duplicates.filter(group => new Set(group.map(row => row.proposed_role)).size > 1),
    official_partitions_applied: false, labels_approved: false, provider_calls: 0 };
  await writeFile(resolve(stage, 'staging-manifest.json'), JSON.stringify({ ...config, chromium_version: version, summary, entries: rows }, null, 2) + '\n');
  await writeFile(resolve(stage, 'summary.json'), JSON.stringify(summary, null, 2) + '\n');
  console.log(JSON.stringify(summary));
  if (summary.errors) process.exitCode = 1;
}

async function encode(entry, bytes, inputFile, page, stage) {
  const type = ({ '.png': 'image/png', '.webp': 'image/webp' })[extname(inputFile).toLowerCase()] || 'image/jpeg';
  const result = await page.evaluate(async ({ input, type }) => {
    const { jpeg } = await import('/src/media.js');
    const blob = new Blob([Uint8Array.from(atob(input), char => char.charCodeAt(0))], { type });
    const normalized = await jpeg(blob);
    const bitmap = await createImageBitmap(normalized);
    const dimensions = [bitmap.width, bitmap.height]; bitmap.close();
    const buffer = new Uint8Array(await normalized.arrayBuffer());
    let binary = '';
    for (let i = 0; i < buffer.length; i += 0x8000) binary += String.fromCharCode(...buffer.subarray(i, i + 0x8000));
    return { output: btoa(binary), dimensions };
  }, { input: bytes.toString('base64'), type });
  const normalized = Buffer.from(result.output, 'base64');
  if (Math.max(...result.dimensions) > 1600 || Math.min(...result.dimensions) < 64 || normalized[0] !== 255 || normalized[1] !== 216) throw Error('Invalid normalized JPEG');
  const file = `jpeg/${entry.proposed_role}/${entry.review_id}.jpg`;
  const destination = confined(stage, file);
  await mkdir(dirname(destination), { recursive: true });
  await writeFile(destination, normalized);
  return { ...entry, jpeg_file: file, normalized_sha256: hash(normalized), jpeg_bytes: normalized.length, jpeg_dimensions: result.dimensions, jpeg_status: 'ok', partition: null, scenario: null };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main().catch(error => { console.error(error.message); process.exitCode = 1; });
