import { PipelineError, signature } from './pipeline.js';
import { artifactFamily } from './recognition-policy.js';

export const GEOMETRY_VERSION = 'planar-target-roi-v1';
// These are conservative POLICY gates, not a claim that an extractor has been
// validated. Enforce mode needs an independently deployed trusted extractor
// using approved artifact-only ROIs. The offline OpenCV study is NOT that service.
export function geometryMode(env) {
  const mode = env.RECOGNITION_GEOMETRY_MODE || 'off';
  if (!['off', 'shadow', 'enforce'].includes(mode) || (mode !== 'off' && typeof env.PLANAR_GEOMETRY?.fetch !== 'function')) {
    throw new PipelineError('INVALID_CONFIGURATION', 'Geometry cần chế độ off/shadow/enforce và service binding đã kiểm chứng.', 503);
  }
  return mode;
}

export function validateGeometry(payload, references, pipelineSignature, mode) {
  if (payload?.version !== GEOMETRY_VERSION || payload.pipeline_signature !== pipelineSignature || !Array.isArray(payload.matches) || payload.matches.length > references.length) throw Error('Invalid geometry envelope');
  const byId = new Map(references.map(row => [row.id, row]));
  const seen = new Set(), best = new Map();
  for (const match of payload.matches) {
    const ref = byId.get(match?.reference_id);
    if (!ref || seen.has(ref.id) || match.reference_digest !== ref.digest || match.roi_scope !== 'artifact_only_approved') throw Error('Geometry reference/ROI mismatch');
    seen.add(ref.id);
    if (!Number.isInteger(match.inliers) || !Number.isInteger(match.match_count) || match.inliers < 0 || match.match_count < match.inliers || match.match_count > 5000) throw Error('Invalid match count');
    for (const key of ['reference_coverage', 'query_coverage']) if (!Number.isFinite(match[key]) || match[key] < 0 || match[key] > 1) throw Error('Invalid coverage');
    if (!Number.isFinite(match.reprojection_error) || match.reprojection_error < 0 || typeof match.projected_quad_valid !== 'boolean') throw Error('Invalid projection');
    const valid = match.projected_quad_valid && match.match_count > 0 && match.inliers / match.match_count >= .45 && match.reference_coverage >= .2 && match.query_coverage >= .02 && match.reprojection_error <= 3;
    if (!valid) continue;
    const row = { artifact_id: ref.artifact_id, inliers: match.inliers, reference_id: ref.id };
    if (!best.has(row.artifact_id) || best.get(row.artifact_id).inliers < row.inliers) best.set(row.artifact_id, row);
  }
  const ranking = [...best.values()].sort((a, b) => b.inliers - a.inliers || a.artifact_id.localeCompare(b.artifact_id));
  const top = ranking[0] || null, runner = ranking[1]?.inliers || 0;
  return { mode, status: 'ready', top, ranking, multiTarget: runner >= 10, weakConflict: (top?.inliers || 0) >= 6,
    pass: !!top && top.inliers >= 24 && top.inliers - runner >= 20 && runner < 10 };
}

export async function planarGeometry(buffer, env, mode) {
  if (mode === 'off') return { mode, status: 'off' };
  try {
    // Look beyond the embedding shortlist so conflicts are not hidden by top-K.
    // Every reference must still be current and ready in authoritative D1.
    const rows = await env.DB.prepare(`SELECT i.id,i.artifact_id,i.digest,i.r2_key,a.external_object_id
      FROM reference_images i JOIN artifacts a ON a.id=i.artifact_id
      WHERE i.status='ready' AND i.signature=? ORDER BY i.id LIMIT 257`).bind(signature(env)).all();
    if (rows.results.length > 256) return { mode, status: 'unavailable', error: 'reference_limit' };
    const refs = rows.results.filter(row => artifactFamily(row.external_object_id) === 'planar');
    if (!refs.length || refs.length > 64) return { mode, status: 'unavailable', error: 'reference_limit' };
    // The extractor needs its own read binding to the reference R2 bucket.
    // Only authoritative D1 keys/digests are sent, never signed public URLs.
    const form = new FormData();
    form.set('file', new Blob([buffer], { type: 'image/jpeg' }), 'query.jpg');
    form.set('references', JSON.stringify(refs));
    form.set('pipeline_signature', signature(env));
    form.set('version', GEOMETRY_VERSION);
    // Service binding only. Never accept an endpoint or evidence from the client.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 4000);
    try {
      const response = await env.PLANAR_GEOMETRY.fetch(new Request('https://planar-geometry.internal/match', { method: 'POST', body: form, signal: controller.signal }));
      if (!response.ok) throw Error('Geometry unavailable');
      const reader = response.body.getReader();
      const chunks = []; let length = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        length += value.byteLength;
        if (length > 128 * 1024) { await reader.cancel(); throw Error('Geometry response too large'); }
        chunks.push(value);
      }
      return validateGeometry(JSON.parse(await new Blob(chunks).text()), refs, signature(env), mode);
    } finally { clearTimeout(timer); }
  } catch {
    // Auxiliary evidence failure must not silently be reported as valid geometry.
    // Existing embedding policy remains usable; no geometry rescue is possible.
    return { mode, status: 'unavailable', error: 'invalid_or_unavailable_evidence' };
  }
}
