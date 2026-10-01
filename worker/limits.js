export function setting(env, name, fallback, min = 0, max = 100000) {
  const value = Number(env[name] ?? fallback);
  if (!Number.isInteger(value) || value < min || value > max) throw new Error(`Cấu hình ${name} không hợp lệ.`);
  return value;
}

// One atomic statement, shared by every Worker isolate. A failed reservation
// never calls the paid API. Consumed reservations are deliberately not refunded.
export async function reserve(env, key, limit, expiresAt, units = 1) {
  const row = await env.DB.prepare(`INSERT INTO usage_buckets(key,used,expires_at)
    SELECT ?,?,? WHERE ? >= ?
    ON CONFLICT(key) DO UPDATE SET used=used+? WHERE used <= ?-? RETURNING used`)
    .bind(key, units, expiresAt, limit, units, units, limit, units).first();
  return Boolean(row);
}

export async function usageStats(env) {
  const day = new Date().toISOString().slice(0, 10);
  const usage = await env.DB.prepare('SELECT used FROM usage_buckets WHERE key=?').bind(`api:${day}`).first();
  return Response.json({ api_today: usage?.used || 0, daily_limit: setting(env, 'DAILY_EMBEDDING_LIMIT', 200) });
}

export async function cleanup(env) {
  await env.DB.prepare('DELETE FROM usage_buckets WHERE expires_at<?').bind(Math.floor(Date.now() / 1000)).run();
  await env.DB.prepare('DELETE FROM recognition_requests WHERE expires_at<=?').bind(Math.floor(Date.now() / 1000)).run();
}

export async function reserveEmbedding(env, units = 1) {
  const day = new Date().toISOString().slice(0, 10);
  if (!await reserve(env, `api:${day}`, setting(env, 'DAILY_EMBEDDING_LIMIT', 200), Math.floor(Date.now()/1000)+172800, units)) {
    const error = new Error('Hôm nay không còn đủ lượt gọi model. Bạn vẫn có thể xem danh mục và ảnh tham chiếu.');
    error.status = 429;
    error.code = 'DAILY_LIMIT_EXCEEDED';
    throw error;
  }
}
