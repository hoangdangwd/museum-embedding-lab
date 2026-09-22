const MAX_IMAGE_BYTES = 15 * 1024 * 1024;
const MAX_REQUEST_BYTES = 32 * 1024 * 1024;
const SESSION_COOKIE = 'embedding_lab_session';
const SESSION_LIFETIME = 7 * 24 * 60 * 60;
const encoder = new TextEncoder();
let modelCheck;
let responseModel = null;

function json(data, status = 200, extra = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...extra },
  });
}

function error(message, status = 400) {
  return json({ detail: message }, status);
}

function b64url(bytes) {
  let text = '';
  const values = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  for (let i = 0; i < values.length; i += 0x8000) {
    text += String.fromCharCode(...values.subarray(i, i + 0x8000));
  }
  return btoa(text).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function unb64url(value) {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((value.length + 3) % 4);
  const text = atob(padded);
  const result = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) result[i] = text.charCodeAt(i);
  return result;
}

async function sign(value, secret) {
  const key = await crypto.subtle.importKey(
    'raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  return b64url(await crypto.subtle.sign('HMAC', key, encoder.encode(value)));
}

async function safeEqual(a, b) {
  const left = encoder.encode(a || '');
  const right = encoder.encode(b || '');
  let result = left.length ^ right.length;
  const length = Math.max(left.length, right.length);
  for (let i = 0; i < length; i++) result |= (left[i] || 0) ^ (right[i] || 0);
  return result === 0;
}

function sessionSecret(env) {
  // The old deployment secret is now only a signing key, never a login password.
  const secret = env.SESSION_SECRET || env.ACCESS_PASSWORD || env.OPENROUTER_API_KEY;
  if (!secret) throw new Error('Chưa cấu hình khóa phiên trên server.');
  return secret;
}

function validUsername(username) {
  return typeof username === 'string' && username.trim().length > 0 && username.length <= 100 && !/[\u0000-\u001f\u007f]/.test(username);
}

async function createSession(username, env) {
  const issued = Math.floor(Date.now() / 1000).toString();
  const nonce = b64url(crypto.getRandomValues(new Uint8Array(18)));
  const payload = `${issued}.${nonce}.${b64url(encoder.encode(username))}`;
  return `${payload}.${await sign(payload, sessionSecret(env))}`;
}

async function sessionUsername(request, env) {
  const header = request.headers.get('Cookie') || '';
  const match = header.match(new RegExp(`(?:^|;\\s*)${SESSION_COOKIE}=([^;]+)`));
  if (!match) return null;
  const parts = match[1].split('.');
  if (parts.length !== 4) return null;
  const issued = Number(parts[0]);
  if (!Number.isSafeInteger(issued) || Date.now() / 1000 - issued < 0 || Date.now() / 1000 - issued >= SESSION_LIFETIME) return null;
  if (!(await safeEqual(parts[3], await sign(parts.slice(0, 3).join('.'), sessionSecret(env))))) return null;
  try {
    const username = new TextDecoder('utf-8', { fatal: true }).decode(unb64url(parts[2]));
    return validUsername(username) ? username : null;
  } catch { return null; }
}

function signature(env) {
  return `openrouter|${env.OPENROUTER_MODEL || 'google/gemini-embedding-2'}|${env.EMBEDDING_VERSION || '1'}|${env.PREPROCESS_VERSION || 'browser-rgb-white-jpeg95-max1600-v1'}`;
}

async function prepare(env) {
  if (!env.OPENROUTER_API_KEY) throw new Error('OPENROUTER_API_KEY chưa được cấu hình trong Cloudflare secret.');
  if (modelCheck) return modelCheck;
  modelCheck = (async () => {
    const response = await fetch('https://openrouter.ai/api/v1/embeddings/models', {
      headers: { Authorization: `Bearer ${env.OPENROUTER_API_KEY}` },
    });
    if (!response.ok) throw new Error(`OpenRouter HTTP ${response.status}: không kiểm tra được model.`);
    const catalog = await response.json();
    const model = (catalog.data || []).find(item => item.id === (env.OPENROUTER_MODEL || 'google/gemini-embedding-2'));
    if (!model || !(model.architecture?.input_modalities || []).includes('image')) {
      throw new Error('Model đã chọn không có image embedding trong danh mục OpenRouter.');
    }
    const aliases = new Set([model.id, model.canonical_slug, model.id?.split('/').pop()].filter(Boolean));
    return { aliases };
  })().catch(err => { modelCheck = null; throw err; });
  return modelCheck;
}

function base64(bytes) {
  let text = '';
  const values = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  for (let i = 0; i < values.length; i += 0x8000) {
    text += String.fromCharCode(...values.subarray(i, i + 0x8000));
  }
  return btoa(text);
}

function dataUrl(buffer) {
  return `data:image/jpeg;base64,${base64(buffer)}`;
}

function normalize(values) {
  if (!Array.isArray(values) || values.length < 2 || values.some(value => !Number.isFinite(value))) {
    throw new Error('Model trả vector không hợp lệ.');
  }
  let norm = 0;
  for (const value of values) norm += value * value;
  norm = Math.sqrt(norm);
  if (!Number.isFinite(norm) || norm <= 1e-12) throw new Error('Model trả vector rỗng/zero.');
  return values.map(value => value / norm);
}

async function embed(buffer, env) {
  const check = await prepare(env);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 90_000);
  try {
    const response = await fetch('https://openrouter.ai/api/v1/embeddings', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.OPENROUTER_API_KEY}`,
        'Content-Type': 'application/json',
        'X-Title': 'Museum Embedding Lab',
      },
      body: JSON.stringify({
        model: env.OPENROUTER_MODEL || 'google/gemini-embedding-2',
        encoding_format: 'float',
        input: [{ content: [{ type: 'image_url', image_url: { url: dataUrl(buffer) } }] }],
      }),
      signal: controller.signal,
    });
    if (!response.ok) {
      const descriptions = { 400: 'Model từ chối định dạng ảnh hoặc tham số.', 401: 'API key thiếu hoặc không hợp lệ.', 402: 'Tài khoản OpenRouter không đủ số dư.', 403: 'Tài khoản không có quyền dùng model.', 404: 'Không tìm thấy model hoặc provider.', 429: 'Vượt giới hạn lượt gọi; hãy thử lại sau.' };
      throw new Error(`OpenRouter HTTP ${response.status}: ${descriptions[response.status] || 'Provider gặp lỗi xử lý.'}`);
    }
    const result = await response.json();
    const row = result.data?.[0];
    if (!row || !Array.isArray(row.embedding)) throw new Error('Model không trả đúng một vector cho ảnh.');
    if (!check.aliases.has(result.model)) throw new Error('Provider trả tên model khác cấu hình; không lưu vector để tránh trộn model.');
    responseModel = result.model;
    return { vector: normalize(row.embedding), usage: result.usage || {} };
  } catch (err) {
    if (err.name === 'AbortError') throw new Error('Model phản hồi quá chậm (90 giây). Hãy thử lại.');
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

async function sha256(buffer) {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', buffer))]
    .map(value => value.toString(16).padStart(2, '0')).join('');
}

function isJpeg(buffer) {
  const bytes = new Uint8Array(buffer);
  return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
}

async function refs(env, sig = signature(env)) {
  const result = await env.DB.prepare(`
    SELECT r.id, r.artifact, r.filename, r.digest, r.width, r.height,
           CASE WHEN e.ref_id IS NULL THEN 0 ELSE 1 END AS indexed
    FROM refs r LEFT JOIN embeddings e ON r.id=e.ref_id AND e.signature=?
    ORDER BY r.artifact, r.id
  `).bind(sig).all();
  return result.results || [];
}

function publicRef(row) {
  return { ...row, indexed: Boolean(row.indexed) };
}

async function imageKey(env, id) {
  const row = await env.DB.prepare('SELECT image_key FROM refs WHERE id=?').bind(id).first();
  if (!row) throw new Error('Không tìm thấy ảnh tham chiếu.');
  return row.image_key;
}

async function addReference(request, env) {
  const form = await request.formData();
  const artifact = String(form.get('artifact') || '').trim();
  const file = form.get('file');
  if (!artifact || artifact.length > 100 || artifact === '_unknown') throw new Error('Tên hiện vật phải có 1–100 ký tự và không được là _unknown.');
  if (!file || typeof file.arrayBuffer !== 'function') throw new Error('Hãy chọn một ảnh.');
  const buffer = await file.arrayBuffer();
  if (!buffer.byteLength || buffer.byteLength > MAX_IMAGE_BYTES) throw new Error('Ảnh phải có dung lượng từ 1 byte đến 15 MB.');
  if (!isJpeg(buffer)) throw new Error('Ảnh chưa được chuẩn hóa thành JPEG. Hãy chọn lại ảnh trong giao diện.');
  const digest = await sha256(buffer);
  const existing = await env.DB.prepare('SELECT id, artifact FROM refs WHERE digest=?').bind(digest).first();
  if (existing) {
    if (existing.artifact !== artifact) throw new Error(`Ảnh này đã thuộc hiện vật '${existing.artifact}'. Không thể gắn hai nhãn khác nhau.`);
    return { id: existing.id, duplicate: true };
  }
  const key = `refs/${crypto.randomUUID()}.jpg`;
  await env.IMAGES.put(key, buffer);
  try {
    const inserted = await env.DB.prepare('INSERT INTO refs(artifact,filename,digest,image_key) VALUES(?,?,?,?) RETURNING id')
      .bind(artifact, String(file.name || 'image.jpg').slice(0, 200), digest, key).first();
    return { id: inserted.id, duplicate: false };
  } catch (err) {
    await env.IMAGES.delete(key);
    throw err;
  }
}

async function buildIndex(env) {
  const sig = signature(env);
  const rows = await refs(env, sig);
  if (!rows.length) throw new Error('Hãy thêm ảnh tham chiếu trước.');
  const pending = rows.filter(row => !row.indexed).slice(0, 10);
  let completed = 0;
  let cached = rows.length - rows.filter(row => !row.indexed).length;
  const errors = [];
  const usage = [];
  await prepare(env);
  for (const row of pending) {
    try {
      const image = await env.IMAGES.get(row.image_key || await imageKey(env, row.id), { type: 'arrayBuffer' });
      if (!image) throw new Error('Không tìm thấy file ảnh trong KV.');
      const result = await embed(image, env);
      const dimensions = result.vector.length;
      const old = await env.DB.prepare('SELECT dimensions FROM embeddings WHERE signature=? LIMIT 1').bind(sig).first();
      if (old && old.dimensions !== dimensions) throw new Error('Chiều vector của model thay đổi. Tăng EMBEDDING_VERSION và lập chỉ mục lại.');
      await env.DB.prepare('INSERT OR REPLACE INTO embeddings(ref_id,signature,dimensions,vector) VALUES(?,?,?,?)')
        .bind(row.id, sig, dimensions, JSON.stringify(result.vector)).run();
      completed++;
      usage.push(result.usage);
    } catch (err) {
      errors.push({ id: row.id, filename: row.filename, error: err.message || 'Lỗi provider.' });
      break;
    }
  }
  const remaining = rows.length - cached - completed;
  return { completed, cached, errors, usage, remaining, seconds: 0, signature: sig, batch_limit: 10 };
}

function finiteNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

async function queryImage(request, env) {
  const form = await request.formData();
  const file = form.get('file');
  if (!file || typeof file.arrayBuffer !== 'function') throw new Error('Hãy chọn một ảnh.');
  const threshold = finiteNumber(form.get('threshold'), 0.8);
  const minMargin = finiteNumber(form.get('min_margin'), 0.05);
  const target = String(form.get('target') || '').trim() || null;
  if (!Number.isFinite(threshold) || threshold < -1 || threshold > 1 || !Number.isFinite(minMargin) || minMargin < 0 || minMargin > 2) throw new Error('Ngưỡng cosine phải trong [-1,1], chênh lệch trong [0,2].');
  const buffer = await file.arrayBuffer();
  const digest = await sha256(buffer);
  const sig = signature(env);
  const rows = await refs(env, sig);
  if (!rows.length) throw new Error('Hãy thêm ảnh tham chiếu và tạo embedding trước.');
  if (rows.some(row => !row.indexed)) throw new Error('Bộ tham chiếu chưa được tạo embedding đầy đủ cho model này. Bấm Tạo embedding trước.');
  if (target && !rows.some(row => row.artifact === target)) throw new Error('Hiện vật mục tiêu không có trong bộ tham chiếu.');
  const started = Date.now();
  const embedded = await embed(buffer, env);
  const embeddingMs = Date.now() - started;
  const vectors = await env.DB.prepare('SELECT ref_id, vector FROM embeddings WHERE signature=? ORDER BY ref_id').bind(sig).all();
  const byId = new Map((vectors.results || []).map(row => [row.ref_id, JSON.parse(row.vector)]));
  const candidatesByArtifact = new Map();
  for (const row of rows) {
    const vector = byId.get(row.id);
    if (!vector || vector.length !== embedded.vector.length) throw new Error('Chiều vector truy vấn khác bộ tham chiếu. Hãy tạo lại chỉ mục.');
    let score = 0;
    for (let i = 0; i < vector.length; i++) score += vector[i] * embedded.vector[i];
    score = Math.max(-1, Math.min(1, score));
    const match = { id: row.id, artifact: row.artifact, filename: row.filename, digest: row.digest, score, image_url: `/api/references/${row.id}/image` };
    if (!candidatesByArtifact.has(row.artifact)) candidatesByArtifact.set(row.artifact, []);
    candidatesByArtifact.get(row.artifact).push(match);
  }
  const candidates = [...candidatesByArtifact.entries()].map(([artifact, matches]) => {
    matches.sort((a, b) => b.score - a.score || a.id - b.id);
    return { artifact, score: matches[0].score, reference_count: matches.length, matches: matches.slice(0, 3) };
  }).sort((a, b) => b.score - a.score || a.artifact.localeCompare(b.artifact));
  const best = candidates[0];
  const margin = candidates.length > 1 ? best.score - candidates[1].score : null;
  let decision = 'match';
  if (best.score < threshold) decision = 'low_similarity';
  else if (margin === null) decision = 'insufficient_catalog';
  else if (margin < minMargin) decision = 'ambiguous';
  else if (target && target !== best.artifact) decision = 'wrong_target';
  return {
    decision, best_artifact: best.artifact, best_score: best.score, margin, target, threshold, min_margin: minMargin,
    candidates: candidates.slice(0, 5), artifact_count: candidates.length, signature: sig,
    dimensions: embedded.vector.length, embedding: embedded.vector, usage: embedded.usage,
    same_as_reference: rows.some(row => row.digest === digest),
    timing_ms: { embedding: embeddingMs, search: Date.now() - started - embeddingMs },
    note: 'Ngưỡng thử nghiệm do người dùng đặt; cosine không phải xác suất đúng.',
  };
}

async function compareImages(request, env) {
  const form = await request.formData();
  const left = form.get('left');
  const right = form.get('right');
  if (!left || !right || typeof left.arrayBuffer !== 'function' || typeof right.arrayBuffer !== 'function') throw new Error('Hãy chọn đủ hai ảnh.');
  const started = Date.now();
  const [a, b] = await Promise.all([embed(await left.arrayBuffer(), env), embed(await right.arrayBuffer(), env)]);
  if (a.vector.length !== b.vector.length) throw new Error('Model trả vector khác chiều cho hai ảnh.');
  let score = 0;
  for (let i = 0; i < a.vector.length; i++) score += a.vector[i] * b.vector[i];
  return { score: Math.max(-1, Math.min(1, score)), dimensions: a.vector.length, signature: signature(env), same_image: await sha256(await left.arrayBuffer()) === await sha256(await right.arrayBuffer()), seconds: (Date.now() - started) / 1000, usage: [a.usage, b.usage], embeddings: { left: a.vector, right: b.vector }, note: 'Điểm cosine chỉ đo độ tương đồng; chưa đủ kết luận hai ảnh là cùng hiện vật.' };
}

function setSecurity(response) {
  const headers = new Headers(response.headers);
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('Referrer-Policy', 'no-referrer');
  headers.set('X-Frame-Options', 'DENY');
  headers.set('Permissions-Policy', 'camera=(self), microphone=(), geolocation=()');
  if (!headers.has('Cache-Control')) headers.set('Cache-Control', 'no-store');
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

async function asset(request, env, pathname) {
  let path = pathname;
  if (path === '/') path = '/index.html';
  if (path.startsWith('/static/')) path = path.slice('/static'.length);
  const url = new URL(request.url);
  url.pathname = path;
  return setSecurity(await env.ASSETS.fetch(new Request(url, request)));
}

export default {
  async fetch(request, env) {
    try {
      const url = new URL(request.url);
      const path = url.pathname;
      const method = request.method;
      const contentLength = Number(request.headers.get('content-length') || 0);
      if (contentLength > MAX_REQUEST_BYTES) return error('Tổng upload vượt 32 MB.', 413);
      if (!['GET', 'HEAD', 'OPTIONS'].includes(method)) {
        const origin = request.headers.get('Origin');
        if (origin && origin !== url.origin) return error('Origin không được phép.', 403);
      }
      if (method === 'OPTIONS') return new Response(null, { status: 204, headers: { 'access-control-allow-origin': url.origin, 'access-control-allow-credentials': 'true' } });

      const publicPath = path === '/login' || path === '/login.html' || path === '/healthz' || path === '/api/session' || path.startsWith('/static/') || path === '/app.js' || path === '/style.css' || path === '/login.js';
      const username = publicPath ? null : await sessionUsername(request, env);
      if (!publicPath && !username) {
        if (path.startsWith('/api/')) return error('Hãy nhập tên người dùng để tiếp tục.', 401);
        return Response.redirect(new URL('/login', request.url), 303);
      }

      if (path === '/healthz') return setSecurity(json({ status: 'ok', service: 'cloudflare-worker' }));
      if (path === '/login' && method === 'GET') return asset(request, env, '/login.html');
      if (path === '/api/session' && method === 'POST') {
        const form = await request.formData();
        const value = form.get('username');
        const username = typeof value === 'string' ? value.trim() : '';
        if (!validUsername(username)) return error('Tên người dùng phải có 1–100 ký tự và không chứa ký tự điều khiển.');
        const token = await createSession(username, env);
        return setSecurity(new Response(JSON.stringify({ ok: true, username }), { headers: { 'content-type': 'application/json; charset=utf-8', 'Set-Cookie': `${SESSION_COOKIE}=${token}; Max-Age=${SESSION_LIFETIME}; Path=/; HttpOnly; Secure; SameSite=Strict` } }));
      }
      if (path === '/api/logout' && method === 'POST') return setSecurity(new Response(JSON.stringify({ ok: true }), { headers: { 'content-type': 'application/json; charset=utf-8', 'Set-Cookie': `${SESSION_COOKIE}=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Strict` } }));
      if (path === '/api/status' && method === 'GET') {
        const list = await refs(env);
        return setSecurity(json({ model: { provider: 'openrouter', model: env.OPENROUTER_MODEL || 'google/gemini-embedding-2', signature: signature(env), configured: Boolean(env.OPENROUTER_API_KEY), loaded: Boolean(modelCheck), response_model: responseModel, device: 'API' }, references: list.map(publicRef), access_required: true, username, reference_count: list.length, indexed_count: list.filter(row => row.indexed).length, artifact_count: new Set(list.map(row => row.artifact)).size }));
      }
      if (path === '/api/model/load' && method === 'POST') { await prepare(env); return setSecurity(json({ provider: 'openrouter', model: env.OPENROUTER_MODEL, signature: signature(env), configured: true, loaded: true, response_model: responseModel, device: 'API' })); }
      if (path === '/api/references' && method === 'POST') return setSecurity(json(await addReference(request, env)));
      const imageMatch = path.match(/^\/api\/references\/(\d+)\/image$/);
      if (imageMatch && method === 'GET') {
        const image = await env.IMAGES.get(await imageKey(env, Number(imageMatch[1])), { type: 'arrayBuffer' });
        if (!image) return error('Không tìm thấy ảnh tham chiếu.', 404);
        return setSecurity(new Response(image, { headers: { 'content-type': 'image/jpeg', 'cache-control': 'private, no-store' } }));
      }
      const deleteMatch = path.match(/^\/api\/references\/(\d+)$/);
      if (deleteMatch && method === 'DELETE') {
        const id = Number(deleteMatch[1]);
        const key = await imageKey(env, id);
        await env.DB.prepare('DELETE FROM refs WHERE id=?').bind(id).run();
        await env.IMAGES.delete(key);
        return setSecurity(json({ deleted: id }));
      }
      if (path === '/api/index' && method === 'POST') return setSecurity(json(await buildIndex(env)));
      if (path === '/api/query' && method === 'POST') return setSecurity(json(await queryImage(request, env)));
      if (path === '/api/compare' && method === 'POST') return setSecurity(json(await compareImages(request, env)));
      if (path.startsWith('/api/')) return error('Không tìm thấy API.', 404);
      return asset(request, env, path);
    } catch (err) {
      console.error(err);
      const message = err.message || 'Có lỗi xử lý.';
      const status = /OpenRouter HTTP 401/.test(message) ? 502 : /not found/i.test(message) ? 404 : 400;
      return setSecurity(error(message, status));
    }
  },
};
