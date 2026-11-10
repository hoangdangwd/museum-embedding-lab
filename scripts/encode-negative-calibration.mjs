// Encode the small offline negative calibration slice with the application's jpeg() helper.
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, extname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');

function confined(root, file) {
  const path = resolve(root, file);
  if (relative(root, path).startsWith('..') || file.includes('\\') || file.includes(':')) throw Error(`Unsafe path: ${file}`);
  return path;
}

const repo = fileURLToPath(new URL('..', import.meta.url));
const stage = resolve(process.argv.find(arg => arg.startsWith('--stage='))?.slice(8) || 'data/staging/drive-negative-calibration-v1');
const run = JSON.parse(await readFile(resolve(stage, 'decode-manifest.json'), 'utf8'));
if (run.provider_calls !== 0 || run.official_partitions_changed || run.entries.length !== 25) throw Error('Invalid negative calibration decode manifest');
const media = await readFile(resolve(repo, 'src/media.js'), 'utf8');
const zoom = await readFile(resolve(repo, 'src/camera-zoom.js'), 'utf8');
const browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH } : {}) });
const rows = [];
try {
  const page = await browser.newPage();
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.origin !== 'http://offline-negative.local') return route.abort();
    if (url.pathname === '/') return route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>offline</title>' });
    if (url.pathname === '/src/media.js') return route.fulfill({ contentType: 'text/javascript', body: media });
    if (url.pathname === '/src/camera-zoom.js') return route.fulfill({ contentType: 'text/javascript', body: zoom });
    return route.abort();
  });
  await page.goto('http://offline-negative.local/');
  for (const entry of run.entries) {
    const input = confined(stage, entry.input_file);
    const bytes = await readFile(input);
    if (hash(bytes) !== entry.input_sha256) throw Error(`Input hash mismatch: ${entry.review_id}`);
    const type = ({ '.png': 'image/png', '.webp': 'image/webp' })[extname(input).toLowerCase()] || 'image/jpeg';
    const result = await page.evaluate(async ({ input, type, reviewId }) => {
      const { jpeg } = await import('/src/media.js');
      const binary = atob(input);
      const source = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) source[i] = binary.charCodeAt(i);
      const normalized = await jpeg(new Blob([source], { type }));
      const bitmap = await createImageBitmap(normalized);
      const dimensions = [bitmap.width, bitmap.height]; bitmap.close();
      const buffer = new Uint8Array(await normalized.arrayBuffer());
      let text = '';
      for (let i = 0; i < buffer.length; i += 0x8000) text += String.fromCharCode(...buffer.subarray(i, i + 0x8000));
      return { reviewId, dimensions, output: btoa(text) };
    }, { input: bytes.toString('base64'), type, reviewId: entry.review_id });
    const normalized = Buffer.from(result.output, 'base64');
    if (Math.max(...result.dimensions) > 1600 || Math.min(...result.dimensions) < 64 || normalized[0] !== 255 || normalized[1] !== 216 || normalized.at(-2) !== 255 || normalized.at(-1) !== 217) throw Error(`Invalid normalized JPEG: ${entry.review_id}`);
    const jpegFile = `jpeg/calibration-negative/${entry.review_id}.jpg`;
    const destination = confined(stage, jpegFile);
    await import('node:fs/promises').then(fs => fs.mkdir(dirname(destination), { recursive: true }));
    await writeFile(destination, normalized);
    rows.push({ ...entry, jpeg_file: jpegFile, jpeg_status: 'ok', normalized_sha256: hash(normalized), jpeg_bytes: normalized.length, jpeg_dimensions: result.dimensions });
  }
} finally { await browser.close(); }
const output = { ...run, chromium_version: browser.version?.(), summary: { entries: rows.length, errors: 0, labels: Object.fromEntries(rows.reduce((map, row) => map.set(row.scenario, (map.get(row.scenario) || 0) + 1), new Map())) }, entries: rows };
await writeFile(resolve(stage, 'staging-manifest.json'), JSON.stringify(output, null, 2) + '\n');
await writeFile(resolve(stage, 'verification.json'), JSON.stringify({ entries: rows.length, hashes_verified: true, originals_changed: false, provider_calls: 0 }, null, 2) + '\n');
console.log(JSON.stringify(output.summary));
