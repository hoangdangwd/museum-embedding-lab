import http from 'node:http';
import { createHash, timingSafeEqual } from 'node:crypto';
import { CodecPool } from './pool.mjs';
const PORT = Number(process.env.PORT || 8787), TOKEN = process.env.JEV_NORMALIZER_TOKEN;
if (typeof TOKEN !== 'string' || TOKEN.length < 32 || !Number.isInteger(PORT) || PORT < 0 || PORT > 65535) throw Error('Invalid service configuration');
const VERSION = 'rgb-oriented-bilinear-jpeg95-fit1568-pad280-v1', MAX_BYTES = 4 * 1024 * 1024;
const concurrency = Number(process.env.CODEC_CONCURRENCY || 2);
if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 4) throw Error('Invalid concurrency');
const pool = new CodecPool(concurrency, 4500);
let active = 0;
const authenticated = req => timingSafeEqual(createHash('sha256').update(req.headers.authorization || '').digest(), createHash('sha256').update(`Bearer ${TOKEN}`).digest());
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const reject = (res, status = 400) => { res.writeHead(status, { 'cache-control': 'no-store' }); res.end(); };
function readBody(req) {
  return new Promise((resolve, rejectPromise) => {
    const parts = []; let size = 0, closed = false;
    const fail = error => { if (!closed) { closed = true; rejectPromise(error); } };
    req.on('data', part => { size += part.length; if (size > MAX_BYTES) { req.destroy(); fail(Error('too large')); } else parts.push(part); });
    req.on('end', () => { if (!closed) { closed = true; resolve(Buffer.concat(parts)); } }); req.on('error', fail); req.on('aborted', () => fail(Error('aborted')));
  });
}
const server = http.createServer(async (req, res) => {
  if (!authenticated(req)) return reject(res, 401);
  if (req.method === 'GET' && req.url === '/healthz') { res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' }); return res.end(JSON.stringify({ ready: true, normalization: VERSION, concurrency })); }
  if (req.method !== 'POST' || req.url !== '/v1/normalize') return reject(res, 404);
  if (req.headers['content-type'] !== 'image/jpeg' || req.headers['x-normalization-version'] !== VERSION) return reject(res, 400);
  if (active >= concurrency) return reject(res, 429);
  const length = req.headers['content-length'];
  if (length && (!/^\d+$/.test(length) || Number(length) > MAX_BYTES)) return reject(res, 413);
  active++;
  const deadline = setTimeout(() => req.destroy(), 6000);
  try {
    const input = await readBody(req), source = hash(input);
    if (req.headers['x-source-sha256'] !== source) return reject(res, 400);
    const output = await pool.run(input), outputHash = hash(output);
    res.writeHead(200, { 'content-type': 'image/jpeg', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff',
      'x-normalization-version': VERSION, 'x-source-sha256': source, 'x-output-sha256': outputHash, 'content-length': output.length }); res.end(output);
  } catch (error) { if (!res.destroyed) reject(res, error.message === 'BUSY' ? 429 : error.message === 'TIMEOUT' ? 504 : 422); }
  finally { clearTimeout(deadline); active--; }
});
server.maxConnections = 20;
server.requestTimeout = 6500;
server.headersTimeout = 5000;
server.keepAliveTimeout = 5000;
server.listen(PORT, '0.0.0.0', () => console.log(`Jev normalizer listening on ${server.address().port}`));
process.on('SIGTERM', async () => { server.close(); await pool.close(); process.exit(0); });
process.on('SIGINT', async () => { server.close(); await pool.close(); process.exit(0); });
