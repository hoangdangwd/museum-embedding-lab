import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { confined, validateManifest } from '../scripts/stage-jpeg.mjs';

function manifest() {
  let id = 0;
  return { owner_staging_approved: true, official_partitions_applied: false, provider_calls: 0,
    entries: Object.entries({ references: 35, calibration: 564, final: 183 }).flatMap(([role, count]) => Array.from({ length: count }, () => ({
      review_id: `R${++id}`, source_file: `source/${id}.jpg`, decode_status: 'ok', proposed_role: role,
      camera_model: role === 'final' ? '22041216G' : 'iPhone XR', reference_selection_owner_approved: role === 'references', partition: null, scenario: null,
    }))) };
}
test('staging path is confined', () => {
  const root = resolve('data/staging/test');
  assert.equal(confined(root, 'jpeg/final/R1.jpg'), resolve(root, 'jpeg/final/R1.jpg'));
  for (const path of ['../outside', '/outside', 'C:/outside', 'jpeg\\a.jpg', '', 'a//b', './a']) assert.throws(() => confined(root, path));
});
test('approved offline staging counts accepted', () => {
  assert.deepEqual(validateManifest(manifest()), { references: 35, calibration: 564, final: 183 });
});
test('staging refuses altered permissions and model calls', () => {
  for (const changes of [{ owner_staging_approved: false }, { official_partitions_applied: true }, { provider_calls: 1 }]) assert.throws(() => validateManifest({ ...manifest(), ...changes }));
});
test('staging refuses duplicate IDs, failed decode, unapproved reference, and applied labels', () => {
  for (const changes of [{ review_id: 'R2' }, { decode_status: 'error' }, { reference_selection_owner_approved: false }, { partition: 'final' }, { scenario: 'known_clean' }, { approved_artifact_id: 'stamp-giong' }]) {
    const data = manifest(); Object.assign(data.entries[0], changes); assert.throws(() => validateManifest(data));
  }
});
test('staging refuses holdout leakage, unexpected final device, or changed counts', () => {
  const data = manifest(); data.entries[0].camera_model = '22041216G'; assert.throws(() => validateManifest(data));
  const final = manifest(); final.entries.at(-1).camera_model = 'iPhone XR'; assert.throws(() => validateManifest(final));
  const fewer = manifest(); fewer.entries.pop(); assert.throws(() => validateManifest(fewer));
});
