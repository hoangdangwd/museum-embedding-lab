// Install a reject-only hard-negative bank through the authenticated admin API.
// This never creates a catalog artifact and does not call the embedding provider.
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { adminClient } from './seed-stamps.mjs';

export const HARD_NEGATIVE_BANKS = {
  'stamp-phat-ba-quan-am': {
    target_external_object_id: 'stamp-phat-ba-quan-am',
    group_key: 'phat-ba-quan-am-confuser-v1',
    files: new Set('R0745 R0746 R0747 R0748 R0749 R0750 R0751'.split(' ').map(name => `calibration/negative/${name}.jpg`)),
  },
  'stamp-hoang-hau-ngoc-truc': {
    target_external_object_id: 'stamp-hoang-hau-ngoc-truc',
    group_key: 'hoang-hau-ngoc-truc-confuser-v1',
    files: new Set('R0738 R0739 R0740 R0741 R0742 R0743 R0752'.split(' ').map(name => `calibration/negative/${name}.jpg`)),
  },
};

export function resolveBankKey(key) {
  if (!key) return null;
  if (HARD_NEGATIVE_BANKS[key]) return key;
  if (key === 'phat-ba' || key === 'phat-ba-quan-am' || key === 'phat-ba-quan-am-confuser-v1') return 'stamp-phat-ba-quan-am';
  if (key === 'hoang-hau' || key === 'hoang-hau-ngoc-truc' || key === 'hoang-hau-ngoc-truc-confuser-v1') return 'stamp-hoang-hau-ngoc-truc';
  return null;
}

export function normalizeVector(values, dimensions = 1536) {
  if (!Array.isArray(values) || values.length !== dimensions || values.some(value => typeof value !== 'number' || !Number.isFinite(value))) throw new Error('Invalid hard-negative vector');
  const norm = Math.hypot(...values);
  if (!Number.isFinite(norm) || norm <= 1e-12) throw new Error('Zero hard-negative vector');
  return values.map(value => value / norm);
}

export async function buildPayload(manifestPath, cachePath, target = 'stamp-phat-ba-quan-am') {
  const bankKey = resolveBankKey(target);
  if (!bankKey) throw new Error(`Unknown hard-negative target or group: ${target}`);
  const bank = HARD_NEGATIVE_BANKS[bankKey];
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  const cache = JSON.parse(await readFile(cachePath, 'utf8'));
  if (!Number.isInteger(manifest.dimensions) || manifest.dimensions < 2 || cache.signature !== manifest.signature) throw new Error('Manifest/cache signature mismatch');
  const entries = manifest.entries.filter(entry => entry.partition === 'calibration' && entry.scenario === 'out_of_catalog' && bank.files.has(entry.file));
  if (entries.length !== bank.files.size) throw new Error(`Expected ${bank.files.size} hard-negative images for ${bank.target_external_object_id}, found ${entries.length}`);
  const vectors = entries.sort((a, b) => a.file.localeCompare(b.file)).map(entry => ({
    id: `hn-${entry.sha256.slice(0, 32)}`,
    digest: entry.sha256,
    vector: normalizeVector(cache.vectors[entry.sha256], manifest.dimensions),
  }));
  return { target_external_object_id: bank.target_external_object_id, vectors, signature: manifest.signature, group_key: bank.group_key };
}

export async function buildAllPayloads(manifestPath, cachePath) {
  const payloads = [];
  for (const key of Object.keys(HARD_NEGATIVE_BANKS)) {
    payloads.push(await buildPayload(manifestPath, cachePath, key));
  }
  return payloads;
}

async function main() {
  const args = process.argv.slice(2);
  const flags = new Set();
  let targetArg = null;
  let base = null;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--apply') {
      flags.add('--apply');
    } else if (arg.startsWith('--target=')) {
      targetArg = arg.slice(9);
    } else if (arg === '--target') {
      targetArg = args[++i];
    } else if (!arg.startsWith('--') && !base) {
      base = arg;
    } else {
      throw new Error(`Unexpected argument: ${arg}`);
    }
  }
  if (!base) throw new Error('Usage: npm run hard-negative:seed -- https://... [--target <id|all>] [--apply]');
  const manifestPath = resolve('data/evaluation/full-calibration-manifest.json');
  const cachePath = resolve('data/evaluation/full-calibration-embeddings.json');
  const apply = flags.has('--apply');
  const targets = (!targetArg || targetArg === 'all')
    ? Object.keys(HARD_NEGATIVE_BANKS)
    : [resolveBankKey(targetArg) || targetArg];

  const results = [];
  const api = apply ? adminClient(base) : null;
  for (const t of targets) {
    const payload = await buildPayload(manifestPath, cachePath, t);
    if (!apply) {
      results.push({ group_key: payload.group_key, target_external_object_id: payload.target_external_object_id, vector_count: payload.vectors.length, signature: payload.signature, applied: false });
    } else {
      const result = await api(`/api/admin/hard-negatives/${encodeURIComponent(payload.group_key)}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ target_external_object_id: payload.target_external_object_id, vectors: payload.vectors, signature: payload.signature }),
      });
      results.push({ ...result, applied: true });
    }
  }
  for (const r of results) {
    console.log(JSON.stringify(r));
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main().catch(error => { console.error(error.message); process.exitCode = 1; });
