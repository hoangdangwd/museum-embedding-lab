// Trusted, owner-approved build-time reference bundle. Never accept client vectors.
import release from '../data/production-catalog.json' with { type: 'json' };
export const APPROVED_RELEASE_ID = release.id;
import { normalize, signature, descriptionSignature, vectorScope, PipelineError } from './pipeline.js';

export function approvedCatalogReference(releaseId, digest, externalId, env) {
  if (releaseId !== release.id || release.owner_production_approved !== true) throw new PipelineError('CATALOG_RELEASE_MISMATCH', 'Bộ reference chưa được duyệt cho bản deploy này.', 409);
  if (release.signature !== signature(env)) throw new PipelineError('CATALOG_RELEASE_SIGNATURE_MISMATCH', 'Bộ reference không cùng pipeline signature; không gọi model thay thế.', 409);
  const entry = release.entries.find(item => item.digest === digest && item.artifact_id === externalId);
  if (!entry) throw new PipelineError('CATALOG_REFERENCE_NOT_APPROVED', 'Hash ảnh/hiện vật không thuộc bộ reference đã duyệt.', 409);
  if (release.description_signature !== descriptionSignature(env) || typeof entry.description !== 'string' || !entry.description.trim() || entry.description.length > 2000) throw new PipelineError('CATALOG_RELEASE_INVALID', 'Mô tả reference đóng gói không hợp lệ.', 503);
  return { vector: normalize(entry.vector), description: entry.description, descriptionSignature: release.description_signature, reviewId: entry.review_id, releaseId: release.id };
}

// ANN scores may differ enough near0.8 to cross the decision threshold.
// Rerank pinned approved references with the exact vector stored in D1.
// Other/legacy catalogs retain their existing behavior until separately migrated.
export function exactReleaseReferenceScore(digest, externalId, cachedVector, queryVector, env) {
  if (release.signature !== signature(env) || !release.entries.some(e => e.digest === digest && e.artifact_id === externalId)) return null;
  try {
    const vector = normalize(JSON.parse(cachedVector));
    return queryVector.reduce((sum, value, i) => sum + value * vector[i], 0);
  } catch {
    throw new PipelineError('APPROVED_REFERENCE_VECTOR_INVALID', 'Vector đã duyệt bị thiếu/hỏng; không dùng điểm xấp xỉ để xác nhận.', 503);
  }
}

export async function catalogReleaseStatus(env, checkIndex = false) {
  const result = await env.DB.prepare('SELECT i.id,i.artifact_id,i.digest,i.signature,i.status,i.vector_id,i.vector_json,a.external_object_id FROM reference_images i JOIN artifacts a ON a.id=i.artifact_id').all();
  const rows = result.results || [], wanted = new Map(release.entries.map(e => [e.digest, e]));
  const matched = rows.filter(row => row.status === 'ready' && row.signature === release.signature && wanted.get(row.digest)?.artifact_id === row.external_object_id);
  const found = new Set(matched.map(r => r.digest));
  const missing = release.entries.filter(e => !found.has(e.digest)).map(e => e.review_id);
  const unexpected = rows.filter(row => !wanted.has(row.digest) || wanted.get(row.digest).artifact_id !== row.external_object_id).map(r => r.id);
  const cachedVectorsVerified = matched.every(row => {
    try { const stored = normalize(JSON.parse(row.vector_json)), expected = normalize(wanted.get(row.digest).vector); return stored.every((v,i) => Math.abs(v - expected[i]) < 1e-12); } catch { return false; }
  });
  let index = { checked: false, verified: false };
  if (checkIndex) {
    // Vectorize getByIds accepts at most20 IDs per request, even for small catalogs.
    const vectors = [];
    for (let start = 0; start < matched.length; start += 20) vectors.push(...await env.VECTORIZE.getByIds(matched.slice(start, start + 20).map(r => r.vector_id)));
    const byId = new Map(vectors.map(v => [v.id, v])), scope = await vectorScope(env), invalid = [];
    for (const row of matched) {
      const actual = byId.get(row.vector_id), expected = wanted.get(row.digest);
      if (!actual || actual.namespace !== scope.namespace || actual.metadata?.artifact_id !== row.artifact_id) { invalid.push(row.id); continue; }
      const v = normalize(actual.values), target = normalize(expected.vector);
      if (v.reduce((sum, x, i) => sum + x * target[i], 0) < 1 - 1e-6) invalid.push(row.id);
    }
    index = { checked: true, verified: invalid.length === 0 && vectors.length === release.entries.length, vectors_found: vectors.length, invalid_image_ids: invalid };
  }
  return { release_id: release.id, reference_set_sha256: release.reference_set_sha256, mode: 'precomputed-only', provider_calls: 0, signature: release.signature, signature_matches_runtime: release.signature === signature(env), expected_references: release.entries.length, live_references: rows.length, matched_ready_references: matched.length, missing_review_ids: missing, unexpected_image_ids: unexpected, catalog_complete: missing.length === 0 && unexpected.length === 0 && rows.length === release.entries.length && cachedVectorsVerified, cached_vectors_verified: cachedVectorsVerified, score_mode: 'exact-cosine-for-approved-release', index,
    policy: { threshold: Number(env.RECOGNITION_THRESHOLD || '.8'), margin: Number(env.RECOGNITION_MARGIN || '.05'), hard_negative_gap: Number(env.RECOGNITION_HARD_NEGATIVE_GAP ?? '0'), daily_embedding_limit: Number(env.DAILY_EMBEDDING_LIMIT) } };
}
