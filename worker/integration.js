import { PipelineError, pipelineConfig, signature, sha256 } from './pipeline.js';

const MAX_BODY = 18 * 1024 * 1024;
const TTL = 86400;
const respond = (body, status = 200, headers = {}) => Response.json(body, { status, headers });
const fail = (code, message, status = 400) => { throw new PipelineError(code, message, status); };

function failure(error, requestId) {
  const status = Number.isInteger(error.status) ? error.status : 500;
  return { status, body: { request_id: requestId, error: { code: error.code || 'INTERNAL_ERROR', message: error.code ? error.message : 'Dịch vụ không xử lý được yêu cầu.', retryable: status === 429 || status >= 500 } } };
}

async function authorized(request, env) {
  const secret = env.RECOGNITION_SERVICE_TOKEN;
  if (typeof secret !== 'string' || secret.length < 32) fail('SERVICE_NOT_CONFIGURED', 'Chưa cấu hình token tích hợp.', 503);
  const token = request.headers.get('Authorization');
  if (!token?.startsWith('Bearer ') || token.length > 1024) return false;
  const [actual, expected] = await Promise.all([sha256(new TextEncoder().encode(token.slice(7))), sha256(new TextEncoder().encode(secret))]);
  let difference = 0;
  for (let i = 0; i < expected.length; i++) difference |= actual.charCodeAt(i) ^ expected.charCodeAt(i);
  return difference === 0;
}

// Canonical API input: JPEG already oriented/resized by the integration adapter.
// Parse the envelope and dimensions before spending API calls. The provider is
// still responsible for decoding the compressed image; this is not a JPEG codec.
export function validateCanonicalJpeg(buffer) {
  const bytes = new Uint8Array(buffer);
  if (bytes.length < 4 || bytes[0] !== 255 || bytes[1] !== 216 || bytes.at(-2) !== 255 || bytes.at(-1) !== 217) fail('INVALID_IMAGE', 'Ảnh JPEG không hợp lệ.');
  let offset = 2, size;
  while (offset < bytes.length - 2) {
    if (bytes[offset++] !== 255) fail('INVALID_IMAGE', 'Cấu trúc JPEG không hợp lệ.');
    while (bytes[offset] === 255) offset++;
    const marker = bytes[offset++];
    if (offset + 2 > bytes.length) break;
    const length = (bytes[offset] << 8) | bytes[offset + 1];
    if (length < 2 || offset + length > bytes.length) fail('INVALID_IMAGE', 'Ảnh JPEG bị cắt thiếu.');
    if (marker === 0xe1 && bytes[offset + 2] === 0x45 && bytes[offset + 3] === 0x78 && bytes[offset + 4] === 0x69 && bytes[offset + 5] === 0x66) fail('NORMALIZATION_REQUIRED', 'Chuẩn hóa hướng ảnh và bỏ EXIF trước khi gửi.', 415);
    if ([0xc0, 0xc1, 0xc2].includes(marker)) {
      if (length < 8) fail('INVALID_IMAGE', 'Kích thước JPEG không hợp lệ.');
      size = { height: (bytes[offset + 3] << 8) | bytes[offset + 4], width: (bytes[offset + 5] << 8) | bytes[offset + 6] };
      if (bytes[offset + 2] !== 8 || bytes[offset + 7] !== 3) fail('NORMALIZATION_REQUIRED', 'Gửi JPEG RGB 8-bit đã chuẩn hóa.', 415);
      if (Math.min(size.width, size.height) < 64 || Math.max(size.width, size.height) > 1600) fail('NORMALIZATION_REQUIRED', 'Cạnh ngắn tối thiểu 64 px, cạnh dài tối đa 1600 px.', 415);
    }
    if (marker === 0xda) {
      if (!size) fail('INVALID_IMAGE', 'JPEG thiếu kích thước ảnh.');
      return size;
    }
    offset += length;
  }
  fail('INVALID_IMAGE', 'JPEG thiếu dữ liệu ảnh.');
}

async function upload(request) {
  if (!request.headers.get('Content-Type')?.toLowerCase().startsWith('multipart/form-data;')) fail('UNSUPPORTED_MEDIA_TYPE', 'Dùng multipart/form-data với trường file.', 415);
  if (Number(request.headers.get('Content-Length') || 0) > MAX_BODY) fail('IMAGE_TOO_LARGE', 'Request vượt 18 MB.', 413);
  const reader = request.body?.getReader();
  if (!reader) fail('INVALID_IMAGE', 'Thiếu ảnh.');
  let length = 0;
  const chunks = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > MAX_BODY) { await reader.cancel(); fail('IMAGE_TOO_LARGE', 'Request vượt 18 MB.', 413); }
    chunks.push(value);
  }
  let form;
  try { form = await new Response(new Blob(chunks), { headers: { 'Content-Type': request.headers.get('Content-Type') } }).formData(); }
  catch { fail('INVALID_REQUEST', 'Multipart không hợp lệ.'); }
  if ([...form.keys()].some(key => key !== 'file') || form.getAll('file').length !== 1) fail('INVALID_REQUEST', 'Chỉ gửi đúng một trường file; ngưỡng và description do server quyết định.');
  const file = form.get('file');
  if (!file || typeof file.arrayBuffer !== 'function' || file.type !== 'image/jpeg') fail('UNSUPPORTED_MEDIA_TYPE', 'Gửi file JPEG đã chuẩn hóa.', 415);
  if (!file.size || file.size > 15 * 1024 * 1024) fail('IMAGE_TOO_LARGE', 'Ảnh phải có dữ liệu và không vượt 15 MB.', 413);
  const buffer = await file.arrayBuffer();
  validateCanonicalJpeg(buffer);
  return buffer;
}

async function catalog(env) {
  const before = await env.DB.prepare('SELECT revision FROM catalog_state WHERE id=1').first();
  const rows = await env.DB.prepare(`SELECT a.id,a.name,a.external_object_id,COUNT(i.id) AS ready_count
    FROM artifacts a LEFT JOIN reference_images i ON i.artifact_id=a.id AND i.status='ready' AND i.signature=?
    GROUP BY a.id ORDER BY a.id`).bind(signature(env)).all();
  const revision = await env.DB.prepare('SELECT revision FROM catalog_state WHERE id=1').first();
  if (before.revision !== revision.revision) fail('CATALOG_CHANGED', 'Danh mục đang thay đổi; kiểm tra lại trạng thái.', 409);
  const ready = rows.results.filter(row => Number(row.ready_count) > 0);
  return { pipeline_version: pipelineConfig(env).mode, pipeline_signature: signature(env), catalog_revision: revision.revision,
    ready: ready.length >= 2 && ready.every(row => row.external_object_id), objects: rows.results };
}

function existingResponse(row, now) {
  if (row.state === 'complete') return new Response(row.response_json, { status: row.response_status, headers: { 'Content-Type': 'application/json', 'X-Idempotent-Replay': 'true' } });
  const stale = now - row.created_at >= 120;
  return respond({ request_id: row.request_id, error: { code: stale ? 'REQUEST_OUTCOME_UNKNOWN' : 'REQUEST_IN_PROGRESS', message: stale ? 'Chưa xác định được kết quả. Tạo lượt mới có thể phát sinh phí mới.' : 'Yêu cầu đang xử lý; kiểm tra lại cùng ID.', retryable: !stale } }, 409, stale ? {} : { 'Retry-After': '3' });
}

export async function integrationApi(request, env, recognize) {
  let requestId = crypto.randomUUID();
  try {
    if (!await authorized(request, env)) fail('UNAUTHORIZED', 'Token tích hợp không hợp lệ.', 401);
    const url = new URL(request.url), now = Math.floor(Date.now() / 1000);
    if (request.headers.get('Origin') || request.headers.get('Sec-Fetch-Site') === 'cross-site') fail('SERVER_ONLY', 'API tích hợp chỉ dành cho backend.', 403);
    if (url.pathname === '/api/v1/catalog' && request.method === 'GET') return respond(await catalog(env));
    const statusPath = url.pathname.match(/^\/api\/v1\/recognitions\/([a-f0-9-]{36})$/);
    if (statusPath && request.method === 'GET') {
      const row = await env.DB.prepare('SELECT * FROM recognition_requests WHERE request_id=? AND expires_at>?').bind(statusPath[1],now).first();
      if (!row) fail('REQUEST_NOT_FOUND', 'Không tìm thấy yêu cầu còn hiệu lực.', 404);
      return existingResponse(row, now);
    }
    if (url.pathname !== '/api/v1/recognitions' || request.method !== 'POST') fail('NOT_FOUND', 'Không tìm thấy API.', 404);
    const key = request.headers.get('Idempotency-Key');
    if (!key || !/^[A-Za-z0-9_-]{8,128}$/.test(key)) fail('INVALID_IDEMPOTENCY_KEY', 'Idempotency-Key phải có 8–128 ký tự chữ, số, gạch nối hoặc gạch dưới.');
    const buffer = await upload(request);
    const hash = await sha256(buffer);
    // No automatic takeover of an in-flight request, including after its lease.
    await env.DB.prepare('DELETE FROM recognition_requests WHERE idempotency_key=? AND expires_at<=?').bind(key,now).run();
    const inserted = await env.DB.prepare(`INSERT INTO recognition_requests(request_id,idempotency_key,digest,state,created_at,expires_at)
      VALUES(?,?,?,'processing',?,?) ON CONFLICT(idempotency_key) DO NOTHING`).bind(requestId,key,hash,now,now+TTL).run();
    if (!inserted.meta?.changes) {
      const row = await env.DB.prepare('SELECT * FROM recognition_requests WHERE idempotency_key=?').bind(key).first();
      if (row.digest !== hash) fail('IDEMPOTENCY_CONFLICT', 'ID yêu cầu đã được dùng với ảnh khác.', 409);
      return existingResponse(row, now);
    }
    let response;
    try {
      const snapshot = await catalog(env);
      if (!snapshot.ready) fail('CATALOG_NOT_READY', 'Cần hai hiện vật cùng pipeline và ánh xạ external_object_id đầy đủ.', 409);
      const result = await recognize(buffer, env);
      const revision = await env.DB.prepare('SELECT revision FROM catalog_state WHERE id=1').first();
      if (revision.revision !== snapshot.catalog_revision) fail('CATALOG_CHANGED', 'Danh mục thay đổi trong lúc xử lý; cần lượt nhận diện mới.', 409);
      if (result.candidates.length < 2) fail('CATALOG_INDEXING', 'Index chưa trả đủ hiện vật để đối chiếu.', 503);
      const byId = new Map(snapshot.objects.map(row => [row.id,row]));
      const status = result.status;
      response = { status: 200, body: { request_id: requestId, status,
        external_object_id: result.recognized ? byId.get(result.artifact_id).external_object_id : null,
        reason: status === 'matched' ? 'threshold_and_margin_passed' : status === 'no_match' ? 'below_threshold' : 'insufficient_margin',
        pipeline_version: result.pipeline_version, pipeline_signature: result.pipeline_signature, catalog_revision: snapshot.catalog_revision,
        candidates: result.candidates.map(candidate => ({ external_object_id: byId.get(candidate.id)?.external_object_id, score: candidate.score })),
        timings: result.timings,
      } };
    } catch (error) { response = failure(error, requestId); }
    await env.DB.prepare("UPDATE recognition_requests SET state='complete',response_json=?,response_status=? WHERE request_id=?")
      .bind(JSON.stringify(response.body),response.status,requestId).run();
    return respond(response.body,response.status);
  } catch (error) { const response = failure(error,requestId); return respond(response.body,response.status); }
}
