// Reversible/offline: preserves source JPEGs/vectors; no providers or catalog writes.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { normalize } from '../services/jev-normalizer/codec.mjs';
import release from '../data/production-catalog.json' with { type: 'json' };
import { NORMALIZATION, jpegFrame } from '../worker/jev-images.js';
const dir = 'reports/jev-external-normalizer-v1/references';
const hash = b => createHash('sha256').update(b).digest('hex');
await mkdir(dir, { recursive: true });
const entries = [];
for (const e of release.entries) {
  const source = await readFile(`data/${e.file}`);
  if (hash(source) !== e.digest) throw Error('Source digest mismatch');
  const output = await normalize(source), dimensions = jpegFrame(output);
  await writeFile(`${dir}/${e.digest}.jpg`, output);
  entries.push({ source_sha256: e.digest, output_sha256: hash(output), artifact_id: e.artifact_id, bytes: output.length, ...dimensions });
}
await writeFile('data/jev-reference-cache.json', JSON.stringify({ release_id: release.id, normalization: NORMALIZATION, entries }, null, 2) + '\n');
console.log(`Prepared ${entries.length} separate Jev reference copies; no source mutations or provider calls`);
