// Writes ONLY separately namespaced derived copies; never catalog/D1/Vectorize.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { adminClient } from './seed-stamps.mjs';
import cache from '../data/jev-reference-cache.json' with { type: 'json' };
const [base, flag, ...extra] = process.argv.slice(2);
if (!base || extra.length || flag && flag !== '--apply') throw Error('Usage: node scripts/provision-jev-references.mjs <deployed HTTPS URL> [--apply]');
const api = adminClient(base), apply = flag === '--apply', dir = 'reports/jev-external-normalizer-v1';
const prepared = [];
for (const e of cache.entries) {
  const bytes = await readFile(`${dir}/references/${e.source_sha256}.jpg`);
  if (bytes.length !== e.bytes || createHash('sha256').update(bytes).digest('hex') !== e.output_sha256) throw Error('Prepared reference output drift; nothing uploaded');
  prepared.push({ entry: e, bytes });
}
const results = [];
for (const { entry, bytes } of prepared) {
  const path = '/api/admin/jev/references/' + entry.source_sha256;
  const before = await api(path);
  if (!before.ready && apply) {
    await api(path, { method: 'PUT', headers: { 'Content-Type': 'image/jpeg' }, body: bytes });
    if (!(await api(path)).ready) throw Error('Derivative verification failed');
  }
  results.push({ source_sha256: entry.source_sha256, action: before.ready ? 'skip' : apply ? 'provisioned' : 'would_provision' });
}
await mkdir(dir, { recursive: true });
const result = { apply, release: cache.release_id, normalization: cache.normalization, references: results.length, provider_calls: 0, catalog_changes: 0, results };
await writeFile(`${dir}/provision-${apply ? 'apply' : 'dry-run'}.json`, JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(result));
