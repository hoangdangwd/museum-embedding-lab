// Replace the bundled stamp references through the admin API, preserving artifact IDs.
// Never delete custom photos; only byte-identical legacy stamp JPEGs are removed.
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { adminClient, prepareImages, prepareStamps, seedStamps } from './seed-stamps.mjs';
import { scanDataset } from './dataset.mjs';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const nameKey = name => name.trim().normalize('NFKC').toLocaleLowerCase('vi');

export async function prepareArtifacts({ sourceFolders = false } = {}) {
  if (!sourceFolders) return prepareProductionCatalog();
  // Explicit research/source-folder mode only; never the production default.
  const { catalog } = await scanDataset();
  const sources = await prepareImages(catalog.flatMap(artifact => artifact.files.map(file => ({ id: artifact.id, name: artifact.name, file }))), new URL('../data/', import.meta.url));
  const normalized = new Map();
  for (const source of sources) {
    const digest = hash(source.bytes);
    if (normalized.has(digest)) throw new Error(`Ảnh tham chiếu trùng sau chuẩn hóa JPEG: ${normalized.get(digest)} = ${source.file}`);
    normalized.set(digest, source.file);
  }
  const legacy = await prepareStamps();
  return catalog.map(artifact => ({ ...artifact,
    references: sources.filter(source => source.id === artifact.id),
    legacyHashes: legacy.filter(source => source.id === artifact.id).map(source => hash(source.bytes)),
  }));
}

export async function prepareProductionCatalog() {
  const root = new URL('../data/', import.meta.url);
  const release = JSON.parse(await readFile(new URL('production-catalog.json', root), 'utf8'));
  if (!release.owner_production_approved || !release.entries?.length || release.paid_calls_authorized_for_provisioning !== 0) throw Error('Production catalog must be an explicitly approved, zero-model-call release');
  const references = [], digests = new Set();
  for (const entry of release.entries) {
    if (!/^catalog-releases\/[a-z0-9-]+\/[A-Z][0-9]+\.jpg$/.test(entry.file)) throw Error('Release file must be a bundled exact-byte JPEG, never an incoming/test path');
    const bytes = await readFile(new URL(entry.file, root));
    if (hash(bytes) !== entry.digest || digests.has(entry.digest) || bytes.length > 15 * 1024 * 1024 || !bytes.subarray(0,3).equals(Buffer.from([255,216,255]))) throw Error(`Invalid/duplicate prepared JPEG: ${entry.review_id}`);
    digests.add(entry.digest);
    references.push({ id: entry.artifact_id, name: entry.name, filename: `${entry.review_id}.jpg`, bytes, catalog_release: release.id });
  }
  const ids = [...new Set(references.map(r => r.id))];
  return ids.map(id => ({ id, name: references.find(r => r.id === id).name, references: references.filter(r => r.id === id), legacyHashes: [], releaseSignature: release.signature, referenceSetSha256: release.reference_set_sha256 }));
}

export async function seedArtifacts(api, catalog, { apply = false, log = console.log } = {}) {
  const released = catalog.filter(e => e.references.some(r => r.catalog_release));
  if (released.length) {
    const status = await api('/api/admin/catalog-release');
    if (status.mode !== 'precomputed-only' || !status.signature_matches_runtime || released.some(e => e.releaseSignature !== status.signature || e.referenceSetSha256 !== status.reference_set_sha256 || e.references.some(r => r.catalog_release !== status.release_id))) throw Error('Server does not support this exact approved release; refusing uploads to prevent paid fallback');
    if (status.unexpected_image_ids.length) throw Error('Unexpected live/custom reference: review backup/catalog before adding this release');
  }
  const results = [];
  for (const entry of catalog) {
    try {
      const { artifacts } = await api('/api/admin/artifacts');
      const matches = artifacts.filter(item => item.external_object_id === entry.id || nameKey(item.name) === nameKey(entry.name));
      if (matches.length > 1) throw new Error('Có nhiều hiện vật trùng mã/tên; cần kiểm tra mapping trước khi xóa ảnh tem.');
      const imports = await seedStamps(api, entry.references, { apply, log });
      if (imports.some(result => result.action === 'error')) throw new Error('Ảnh thay thế chưa sẵn sàng; giữ nguyên ảnh tem của hiện vật này để chạy lại sau.');
      let artifact = matches[0];
      if (!artifact && apply) {
        if (entry.references.length) {
          const refreshed = await api('/api/admin/artifacts');
          artifact = refreshed.artifacts.find(item => item.external_object_id === entry.id || nameKey(item.name) === nameKey(entry.name));
        } else {
          artifact = await api('/api/admin/artifacts', { method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: entry.name, external_object_id: entry.id }),
          });
        }
      }
      const removed = [];
      if (artifact) {
        const { images } = await api(`/api/admin/artifacts/${encodeURIComponent(artifact.id)}/images`);
        const stored = await Promise.all(images.map(async image => ({ ...image,
          hash: hash(await api(`/api/admin/images/${encodeURIComponent(image.id)}`, {}, true)),
        })));
        // Hash each reference once; avoid quadratic JPEG hashing for large batches.
        const readyHashes = new Set(stored.filter(image => image.status === 'ready' && !image.needs_reprocess).map(image => image.hash));
        // All replacement views must be ready before deleting any old stamp for this artifact.
        if (apply && !entry.references.every(reference => readyHashes.has(hash(reference.bytes)))) {
          throw new Error('Ảnh thay thế chưa sẵn sàng; chưa xóa ảnh tem.');
        }
        for (const image of stored.filter(image => entry.legacyHashes.includes(image.hash))) {
          if (image.status === 'pending') throw new Error('Ảnh tem đang pending; kiểm tra lượt xử lý trước khi xóa.');
          if (apply) await api(`/api/admin/images/${encodeURIComponent(image.id)}`, { method: 'DELETE' });
          removed.push(image.id);
        }
      }
      const missing = entry.references.length === 0;
      log(`${entry.name}: ${apply ? '' : '[dry-run] '}remove ${removed.length} stamp reference(s)${missing ? '; CHƯA CÓ ẢNH HIỆN VẬT' : ''}`);
      results.push({ id: entry.id, artifact_id: artifact?.id ?? null, action: missing ? 'missing' : 'ready', imports, removed, applied: apply });
    } catch (error) {
      log(`${entry.name}: ${error.message}`);
      results.push({ id: entry.id, action: 'error', error: error.message });
    }
  }
  return results;
}

async function main() {
  const [base, ...flags] = process.argv.slice(2);
  if (!base || flags.some(flag => !['--apply', '--source-folders'].includes(flag))) throw new Error('Usage: npm run catalog:seed -- https://host [--apply] [--source-folders] (default: approved production package, zero paid calls)');
  const api = adminClient(base);
  await api('/api/admin/artifacts');
  const catalog = await prepareArtifacts({ sourceFolders: flags.includes('--source-folders') });
  const results = await seedArtifacts(api, catalog, { apply: flags.includes('--apply') });
  const failed = results.filter(item => item.action === 'error').length;
  console.log(JSON.stringify({ total: results.length, missing: results.filter(item => item.action === 'missing').map(item => item.id), removed: results.reduce((sum, item) => sum + (item.removed?.length || 0), 0), failed }));
  if (failed) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
