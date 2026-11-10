// Shared admin/JPEG provisioning helpers and the legacy stamp-source decoder.
// The old CLI is disabled: seed-artifacts.mjs is the active catalog entry point.
// Uses the real JPEG helper and admin pipeline; never writes D1/R2/Vectorize directly.
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { basename, extname, resolve } from 'node:path';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const nameKey = name => name.trim().normalize('NFKC').toLocaleLowerCase('vi');

export function adminClient(base, credentials = process.env) {
  const url = new URL(base);
  if (url.username || url.password || (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname)))) {
    throw new Error('Use HTTPS (or HTTP localhost), without credentials in the URL.');
  }
  const headers = {};
  if (credentials.CF_ACCESS_CLIENT_ID && credentials.CF_ACCESS_CLIENT_SECRET) {
    headers['CF-Access-Client-Id'] = credentials.CF_ACCESS_CLIENT_ID;
    headers['CF-Access-Client-Secret'] = credentials.CF_ACCESS_CLIENT_SECRET;
  }
  return async (path, options = {}, binary = false) => {
    const response = await fetch(url.origin + path, {
      ...options, headers: { ...headers, ...options.headers }, redirect: 'error', signal: AbortSignal.timeout(90_000),
    });
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new Error(`HTTP ${response.status}: ${body.detail || 'Admin API failed'}`);
    }
    return binary ? Buffer.from(await response.arrayBuffer()) : response.json();
  };
}

export async function prepareStamps() {
  const catalog = JSON.parse(await readFile(new URL('../data/Stamp/catalog.json', import.meta.url), 'utf8'));
  return prepareImages(catalog, new URL('../data/Stamp/', import.meta.url));
}

export async function prepareImages(catalog, root) {
  const { chromium } = await import('@playwright/test');
  const browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH } : {}) });
  try {
    const page = await browser.newPage();
    // Serve only local modules in an isolated browser. No application page, network,
    // credentials or provider calls are involved in preprocessing.
    const files = new Map(await Promise.all(['media.js', 'camera-zoom.js'].map(async file => [
      `/src/${file}`, await readFile(new URL(`../src/${file}`, import.meta.url), 'utf8'),
    ])));
    await page.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (url.origin !== 'http://stamp-seed.local') return route.abort();
      if (url.pathname === '/') return route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Local JPEG preparation</title>' });
      if (!files.has(url.pathname)) return route.abort();
      return route.fulfill({ contentType: 'text/javascript', body: files.get(url.pathname) });
    });
    await page.goto('http://stamp-seed.local/');
    const prepared = [];
    for (const stamp of catalog) {
      const source = await readFile(resolve(fileURLToPath(root), stamp.file));
      const bytes = await page.evaluate(async ({ base64, type, crop }) => {
        const { jpeg } = await import('/src/media.js');
        const blob = new Blob([Uint8Array.from(atob(base64), char => char.charCodeAt(0))], { type });
        return Array.from(new Uint8Array(await (await jpeg(blob, crop)).arrayBuffer()));
      }, { base64: source.toString('base64'), type: ({ '.webp': 'image/webp', '.png': 'image/png' })[extname(stamp.file).toLowerCase()] || 'image/jpeg', crop: stamp.crop ?? null });
      prepared.push({ ...stamp, filename: basename(stamp.file).replace(/\.(webp|png|jpe?g)$/i, '.jpg'), bytes: Buffer.from(bytes) });
    }
    return prepared;
  } finally { await browser.close(); }
}

export async function seedStamps(api, stamps, { apply = false, log = console.log } = {}) {
  const { artifacts } = await api('/api/admin/artifacts');
  const results = [], imagesByArtifact = new Map();
  for (const stamp of stamps) {
    try {
      let artifact = artifacts.find(item => item.external_object_id === stamp.id)
        || artifacts.find(item => nameKey(item.name) === nameKey(stamp.name));
      const digest = hash(stamp.bytes);
      let stored = artifact && imagesByArtifact.get(artifact.id);
      if (artifact && !stored) {
        stored = new Map();
        const { images } = await api(`/api/admin/artifacts/${encodeURIComponent(artifact.id)}/images`);
        for (const image of images) {
          // Download/hash each stored image once, not once per source (large catalogs).
          const bytes = await api(`/api/admin/images/${encodeURIComponent(image.id)}`, {}, true);
          stored.set(hash(bytes), image);
        }
        imagesByArtifact.set(artifact.id, stored);
      }
      const existing = stored?.get(digest);
      let action = !existing ? 'import' : existing.status === 'pending' ? 'pending'
        : existing.needs_reprocess ? 'reprocess' : existing.status === 'failed' ? 'retry' : 'skip';
      if (action === 'pending') throw new Error('Ảnh đang pending; kiểm tra lượt xử lý trước, không gửi lại tự động.');
      if (stamp.catalog_release && !['import', 'skip'].includes(action)) throw new Error('Approved catalog release cannot invoke paid retry/reprocess; inspect saved vectors and repair explicitly.');
      if (apply && action !== 'skip') {
        if (!artifact) {
          artifact = await api('/api/admin/artifacts', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: stamp.name, external_object_id: stamp.id }),
          });
          artifacts.push(artifact);
          stored = new Map();
          imagesByArtifact.set(artifact.id, stored);
        }
        if (action === 'import') {
          const form = new FormData();
          form.set('file', new Blob([stamp.bytes], { type: 'image/jpeg' }), stamp.filename);
          if (stamp.catalog_release) form.set('catalog_release', stamp.catalog_release);
          const imported = await api(`/api/admin/artifacts/${encodeURIComponent(artifact.id)}/images`, { method: 'POST', body: form });
          if (stamp.catalog_release && (imported.catalog_release !== stamp.catalog_release || imported.provider_calls !== 0)) throw new Error('Server did not acknowledge precomputed-only provisioning; stopped without retries.');
          stored.set(digest, imported);
        } else {
          const updated = await api(`/api/admin/images/${encodeURIComponent(existing.id)}/${action}`, { method: 'POST' });
          stored.set(digest, { ...existing, ...updated, needs_reprocess: false });
        }
      }
      const result = { id: stamp.id, artifact_id: artifact?.id ?? null, action, applied: apply && action !== 'skip' };
      results.push(result);
      log(`${stamp.id}: ${apply ? '' : '[dry-run] '}${action}`);
    } catch (error) {
      results.push({ id: stamp.id, action: 'error', error: error.message });
      log(`${stamp.id}: ${error.message}`);
    }
  }
  return results;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  console.error('Ảnh tem không còn là bộ tham chiếu. Dùng npm run catalog:seed để nạp ảnh bảo vật trong data/artifacts.json.');
  process.exitCode = 1;
}
