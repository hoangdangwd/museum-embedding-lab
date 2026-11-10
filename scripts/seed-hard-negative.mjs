// Install a reject-only hard-negative bank through the authenticated admin API.
// This never creates a catalog artifact and does not call the embedding provider.
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { adminClient } from './seed-stamps.mjs';

const TARGET_EXTERNAL_ID = 'stamp-phat-ba-quan-am';
const GROUP_KEY = 'phat-ba-quan-am-confuser-v1';
const FILES = new Set([...'R0745 R0746 R0747 R0748 R0749 R0750 R0751'.split(' ').map(name => `calibration/negative/${name}.jpg`)]);

export function normalizeVector(values, dimensions = 1536) {
  if (!Array.isArray(values) || values.length !== dimensions || values.some(value => typeof value !== 'number' || !Number.isFinite(value))) throw new Error('Invalid hard-negative vector');
  const norm = Math.hypot(...values);
  if (!Number.isFinite(norm) || norm <= 1e-12) throw new Error('Zero hard-negative vector');
  return values.map(value => value / norm);
}

export async function buildPayload(manifestPath, cachePath) {
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  const cache = JSON.parse(await readFile(cachePath, 'utf8'));
  if (!Number.isInteger(manifest.dimensions) || manifest.dimensions < 2 || cache.signature !== manifest.signature) throw new Error('Manifest/cache signature mismatch');
  const entries = manifest.entries.filter(entry => entry.partition === 'calibration' && entry.scenario === 'out_of_catalog' && FILES.has(entry.file));
  if (entries.length !== FILES.size) throw new Error(`Expected ${FILES.size} hard-negative images, found ${entries.length}`);
  const vectors = entries.sort((a, b) => a.file.localeCompare(b.file)).map(entry => ({
    id: `hn-${entry.sha256.slice(0, 32)}`,
    digest: entry.sha256,
    vector: normalizeVector(cache.vectors[entry.sha256], manifest.dimensions),
  }));
  return { target_external_object_id: TARGET_EXTERNAL_ID, vectors, signature: manifest.signature, group_key: GROUP_KEY };
}

async function main() {
  const [base, ...flags] = process.argv.slice(2);
  if (!base || flags.some(flag => flag !== '--apply')) throw new Error('Usage: npm run hard-negative:seed -- https://... --apply');
  const payload = await buildPayload(resolve('data/evaluation/full-calibration-manifest.json'), resolve('data/evaluation/full-calibration-embeddings.json'));
  if (!flags.includes('--apply')) {
    console.log(JSON.stringify({ group_key: GROUP_KEY, target_external_object_id: TARGET_EXTERNAL_ID, vector_count: payload.vectors.length, signature: payload.signature, applied: false }));
    return;
  }
  const api = adminClient(base);
  const result = await api(`/api/admin/hard-negatives/${encodeURIComponent(GROUP_KEY)}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ target_external_object_id: payload.target_external_object_id, vectors: payload.vectors, signature: payload.signature }),
  });
  console.log(JSON.stringify({ ...result, applied: true }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main().catch(error => { console.error(error.message); process.exitCode = 1; });
