// Remote path performs bounded binary I/O only, never pixel processing.
import { jpegFrame, MAX_SOURCE_BYTES, NORMALIZATION } from './jev-images.js';
import { sha256, signature } from './pipeline.js';
import cache from '../data/jev-reference-cache.json' with { type: 'json' };
import { APPROVED_RELEASE_ID, approvedCatalogReference } from './catalog-release.js';
export const NORMALIZER_VERSION = NORMALIZATION;
export const REFERENCE_PREFIX = `jev-derived/${NORMALIZATION}/`;

export function validateNormalizedJpeg(bytes) {
  const frame = jpegFrame(bytes);
  if (Math.min(frame.width, frame.height) < 280 || Math.max(frame.width, frame.height) > 1568) throw Error('INVALID_IMAGE');
  return bytes;
}

export async function normalizeRemoteQuery(input, env, request = fetch) {
  let url;
  try { url = new URL(env.JEV_NORMALIZER_URL); } catch { throw Error('NORMALIZER_UNAVAILABLE'); }
  const token = env.JEV_NORMALIZER_TOKEN;
  const timeout = Number(env.JEV_NORMALIZER_TIMEOUT_MS || 5000);
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash ||
      typeof token !== 'string' || token.length < 32 || !Number.isInteger(timeout) || timeout < 100 || timeout > 10000) throw Error('NORMALIZER_UNAVAILABLE');
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  jpegFrame(bytes);
  const sourceDigest = await sha256(bytes), controller = new AbortController();
  let timer, response, reader;
  try {
    // Deadline includes fetch AND streamed body, even if fetch ignores abort.
    const deadline = new Promise((_, reject) => { timer = setTimeout(() => {
      controller.abort(); reader?.cancel().catch(() => {}); reject(Error('NORMALIZER_UNAVAILABLE'));
    }, timeout); });
    return await Promise.race([deadline, (async () => {
      response = await request(url.href, {
        method: 'POST', redirect: 'manual', signal: controller.signal,
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'image/jpeg',
          'X-Normalization-Version': NORMALIZER_VERSION, 'X-Source-Sha256': sourceDigest },
        body: bytes,
      });
      if (controller.signal.aborted) { await response.body?.cancel(); throw Error('NORMALIZER_UNAVAILABLE'); }
      const length = response.headers.get('content-length');
      if (!response.ok || response.headers.get('content-type') !== 'image/jpeg' ||
          response.headers.get('x-normalization-version') !== NORMALIZER_VERSION ||
          response.headers.get('x-source-sha256') !== sourceDigest ||
          length !== null && (!/^\d+$/.test(length) || Number(length) > MAX_SOURCE_BYTES)) throw Error('NORMALIZER_UNAVAILABLE');
      reader = response.body?.getReader();
      if (!reader) throw Error('NORMALIZER_UNAVAILABLE');
      const chunks = []; let size = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (controller.signal.aborted) throw Error('NORMALIZER_UNAVAILABLE');
        if (done) break;
        size += value.length;
        if (size > MAX_SOURCE_BYTES) throw Error('NORMALIZER_UNAVAILABLE');
        chunks.push(value);
      }
      const output = new Uint8Array(size); let offset = 0;
      for (const part of chunks) { output.set(part, offset); offset += part.length; }
      if (await sha256(output) !== response.headers.get('x-output-sha256')) throw Error('NORMALIZER_UNAVAILABLE');
      return validateNormalizedJpeg(output);
    })()]);
  } catch { throw Error('NORMALIZER_UNAVAILABLE'); }
  finally {
    clearTimeout(timer); controller.abort();
    // Do not await cancellation of an untrusted/non-terminating stream.
    try { if (reader) reader.cancel().catch(() => {}); else response?.body?.cancel().catch(() => {}); } catch { /* Already closed. */ }
  }
}

export async function normalizedReference(source, env) {
  const sourceDigest = await sha256(source);
  // Only trusted admin provisioner writes this separate prefix. User image
  // endpoints cannot write here; missing/corrupt cache NEVER invokes a codec.
  const expected = cache.entries.find(e => e.source_sha256 === sourceDigest);
  if (cache.release_id !== APPROVED_RELEASE_ID || cache.normalization !== NORMALIZER_VERSION || !expected) throw Error('REFERENCE_UNAVAILABLE');
  const object = await env.IMAGES.get(`${REFERENCE_PREFIX}${sourceDigest}.jpg`);
  if (!object || object.size !== expected.bytes || object.size > MAX_SOURCE_BYTES) throw Error('REFERENCE_UNAVAILABLE');
  const bytes = new Uint8Array(await object.arrayBuffer());
  if (await sha256(bytes) !== expected.output_sha256) throw Error('REFERENCE_UNAVAILABLE');
  return validateNormalizedJpeg(bytes);
}

// Called ONLY after the existing admin authorization. The compiled manifest
// pins every output; admin callers cannot substitute pixels/vectors/references.
export async function provisionJevReference(request, env, sourceDigest) {
  const result = (body, status = 200) => Response.json(body, { status });
  const expected = cache.entries.find(e => e.source_sha256 === sourceDigest);
  if (!expected || cache.release_id !== APPROVED_RELEASE_ID || cache.normalization !== NORMALIZER_VERSION) return result({ detail: 'Reference not approved' }, 409);
  approvedCatalogReference(APPROVED_RELEASE_ID, sourceDigest, expected.artifact_id, env);
  const row = await env.DB.prepare(`SELECT i.id FROM reference_images i JOIN artifacts a ON a.id=i.artifact_id WHERE i.digest=? AND a.external_object_id=? AND i.signature=? AND i.status='ready'`)
    .bind(sourceDigest, expected.artifact_id, signature(env)).first();
  if (!row) return result({ detail: 'Reference not active' }, 409);
  const key = `${REFERENCE_PREFIX}${sourceDigest}.jpg`;
  if (request.method === 'GET') {
    const object = await env.IMAGES.get(key);
    const ready = Boolean(object && object.size === expected.bytes && await sha256(await object.arrayBuffer()) === expected.output_sha256);
    return result({ source_sha256: sourceDigest, ready, normalization: NORMALIZER_VERSION });
  }
  if (request.headers.get('content-type') !== 'image/jpeg') return result({ detail: 'JPEG required' }, 400);
  const reader = request.body?.getReader();
  if (!reader) return result({ detail: 'JPEG required' }, 400);
  const parts = []; let size = 0;
  try {
    for (;;) { const { done, value } = await reader.read(); if (done) break; size += value.length; if (size > expected.bytes) { reader.cancel().catch(() => {}); return result({ detail: 'Unexpected bytes' }, 400); } parts.push(value); }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const part of parts) { bytes.set(part, offset); offset += part.length; }
  if (size !== expected.bytes || await sha256(bytes) !== expected.output_sha256) return result({ detail: 'Digest mismatch' }, 409);
  validateNormalizedJpeg(bytes);
  await env.IMAGES.put(key, bytes, { httpMetadata: { contentType: 'image/jpeg' }, customMetadata: { source_sha256: sourceDigest, output_sha256: expected.output_sha256, normalization: NORMALIZER_VERSION } });
  return result({ source_sha256: sourceDigest, ready: true, provider_calls: 0 });
}

export async function normalizeJevPair(query, reference, env, request = fetch) {
  if (env.JEV_IMAGE_PROCESSOR === 'local') {
    // Explicit legacy/test mode only. Production uses remote and has no codec fallback.
    const { normalizeJevImage } = await import('./jev-images.js');
    const r = await normalizeJevImage(reference), q = await normalizeJevImage(query);
    return { query: { bytes: q }, reference: { bytes: r } };
  }
  if (env.JEV_IMAGE_PROCESSOR !== 'remote') throw Error('NORMALIZER_UNAVAILABLE');
  const r = await normalizedReference(reference, env);
  const q = await normalizeRemoteQuery(query, env, request);
  return { query: { bytes: q }, reference: { bytes: r } };
}
