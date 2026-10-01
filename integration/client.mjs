// Server-side adapter. Do not bundle credentials into browser code.
export function createRecognitionClient({ baseUrl, token, accessClientId, accessClientSecret, request = fetch, timeoutMs = 90000 }) {
  if (typeof window !== 'undefined') throw new Error('Recognition service credentials belong on the backend.');
  const origin = new URL(baseUrl);
  if (origin.protocol !== 'https:' && !(origin.protocol === 'http:' && ['localhost','127.0.0.1'].includes(origin.hostname))) throw new Error('Use HTTPS for the recognition service.');
  if (origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash) throw new Error('baseUrl must be a plain service origin.');
  if (typeof token !== 'string' || token.length < 32) throw new Error('A server-side service token is required.');
  async function call(path, options = {}) {
    const headers = { Authorization: `Bearer ${token}`, ...options.headers };
    if (accessClientId && accessClientSecret) { headers['CF-Access-Client-Id'] = accessClientId; headers['CF-Access-Client-Secret'] = accessClientSecret; }
    const response = await request(`${origin.origin}${path}`, { ...options, headers, signal: AbortSignal.timeout(timeoutMs), redirect: 'error' });
    const result = await response.json();
    if (!response.ok) {
      const error = new Error(result.error?.message || 'Recognition service failed.');
      error.code = result.error?.code || 'INVALID_RESPONSE'; error.status = response.status; error.requestId = result.request_id; error.retryable = result.error?.retryable === true;
      throw error;
    }
    return result;
  }
  return {
    catalog: () => call('/api/v1/catalog'),
    recognize(file, idempotencyKey) {
      if (!idempotencyKey) throw new Error('Pass a stable key per user action; reuse it when recovering a lost response.');
      const body = new FormData(); body.set('file',file,'query.jpg');
      return call('/api/v1/recognitions',{method:'POST',headers:{'Idempotency-Key':idempotencyKey},body});
    },
    result(requestId) {
      if (!/^[a-f0-9-]{36}$/.test(requestId)) throw new Error('Invalid request ID.');
      return call(`/api/v1/recognitions/${requestId}`);
    },
  };
}
