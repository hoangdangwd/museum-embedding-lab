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
  return `openrouter|${env.OPENROUTER_MODEL || 'google/gemini-embedding-2'}|${env.EMBEDDING_VERSION || '1'}|${env.EMBEDDING_VERSION || '1'}|${env.PREPROCESS_VERSION || 'rgb-exif-white-jpeg95-max1600-v1'}`;
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

async function refs(env) {
  const result = await env.DB.prepare(`
    SELECT artifact, vector, dimensions FROM recognition_references
    WHERE signature=? ORDER BY digest
  `).bind(signature(env)).all();
  return result.results || [];
}

async function queryImage(request, env) {
  const form = await request.formData();
  const file = form.get('file');
  if (!file || typeof file.arrayBuffer !== 'function') return error('Hãy chụp một ảnh.', 400);
  if (!file.size || file.size > 15 * 1024 * 1024) return error('Ảnh không hợp lệ.', 400);
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff) return error('Ảnh không hợp lệ.', 400);
  const rows = await refs(env);
  if (!rows.length || rows.some(row => !row.vector)) return error('Nhận diện chưa sẵn sàng. Hãy thử lại sau.', 503);
  const threshold = Number(env.RECOGNITION_THRESHOLD || '0.8');
  const minMargin = Number(env.RECOGNITION_MARGIN || '0.05');
  if (!Number.isFinite(threshold) || threshold < -1 || threshold > 1 || !Number.isFinite(minMargin) || minMargin < 0 || minMargin > 2) {
    throw new Error('Invalid recognition configuration');
  }
  const embedded = await embed(buffer, env);
  const scores = new Map();
  for (const row of rows) {
    const vector = JSON.parse(row.vector);
    if (!Array.isArray(vector) || vector.length !== embedded.vector.length || vector.some(value => !Number.isFinite(value))) {
      throw new Error('Invalid reference vector');
    }
    let score = 0;
    for (let i = 0; i < vector.length; i++) score += vector[i] * embedded.vector[i];
    scores.set(row.artifact, Math.max(scores.get(row.artifact) ?? -1, Math.max(-1, Math.min(1, score))));
  }
  const ranked = [...scores].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const recognized = ranked.length >= 2 && ranked[0][1] >= threshold && ranked[0][1] - ranked[1][1] >= minMargin;
  return json({ recognized, artifact: recognized ? ranked[0][0] : null });
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
        return setSecurity(json({ username, ready: list.length > 0 && list.every(row => Boolean(row.vector)) }));
      }
      if (path === '/api/query' && method === 'POST') return setSecurity(await queryImage(request, env));
      if (path.startsWith('/api/')) return error('Không tìm thấy API.', 404);
      return asset(request, env, path);
    } catch (err) {
      console.error(err);
      return setSecurity(error('Không nhận diện được lúc này. Hãy thử lại.', 502));
    }
  },
};
