import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { request, setSession, clearSession, refreshSession, onSessionEnded, ApiError } from './client.js';

// A fake backend: each call to fetch() takes the next scripted answer.
function scriptFetch(...answers) {
  const calls = [];
  const fetchMock = vi.fn(async (url, options = {}) => {
    calls.push({ url, ...options });
    const [status, body] = answers.shift() ?? [500, { error: { code: 'NO_SCRIPT', message: 'unexpected call' } }];
    return new Response(body === null ? null : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  });
  vi.stubGlobal('fetch', fetchMock);
  return calls;
}

const expired = [401, { error: { status: 401, code: 'TOKEN_EXPIRED', message: 'Access token has expired' } }];
const refreshed = [200, { accessToken: 'new-token', expiresIn: 900 }];

beforeEach(() => setSession({ accessToken: 'old-token', expiresIn: 900 }));
afterEach(() => {
  clearSession();
  vi.unstubAllGlobals();
});

describe('request()', () => {
  it('sends the access token and returns the JSON body', async () => {
    const calls = scriptFetch([200, { ok: true }]);
    expect(await request('/thing')).toEqual({ ok: true });
    expect(calls[0].url).toBe('http://api.test/thing');
    expect(calls[0].headers.Authorization).toBe('Bearer old-token');
  });

  it('on TOKEN_EXPIRED: refreshes once with the cookie, then retries with the new token', async () => {
    const calls = scriptFetch(expired, refreshed, [200, { ok: true }]);
    expect(await request('/thing')).toEqual({ ok: true });
    expect(calls.map((c) => c.url)).toEqual(['http://api.test/thing', 'http://api.test/auth/refresh', 'http://api.test/thing']);
    expect(calls[1].credentials).toBe('include'); // the refresh cookie is sent
    expect(calls[2].headers.Authorization).toBe('Bearer new-token');
  });

  it('many requests expiring together share ONE refresh (a second would look like token theft)', async () => {
    let refreshCalls = 0;
    vi.stubGlobal('fetch', vi.fn(async (url, options) => {
      if (url.endsWith('/auth/refresh')) {
        refreshCalls++;
        await new Promise((r) => setTimeout(r, 10));
        return new Response(JSON.stringify({ accessToken: 'new-token', expiresIn: 900 }), { status: 200 });
      }
      const ok = options.headers.Authorization === 'Bearer new-token';
      return new Response(JSON.stringify(ok ? { ok } : { error: { code: 'TOKEN_EXPIRED', message: 'x' } }), { status: ok ? 200 : 401 });
    }));
    const results = await Promise.all([request('/a'), request('/b'), request('/c')]);
    expect(results).toEqual([{ ok: true }, { ok: true }, { ok: true }]);
    expect(refreshCalls).toBe(1);
  });

  it('refreshes before sending when the token is about to expire', async () => {
    setSession({ accessToken: 'old-token', expiresIn: 30 }); // less than the 60 s margin
    const calls = scriptFetch(refreshed, [200, { ok: true }]);
    await request('/thing');
    expect(calls[0].url).toBe('http://api.test/auth/refresh');
    expect(calls[1].headers.Authorization).toBe('Bearer new-token');
  });

  it('ends the session when the refresh fails', async () => {
    const ended = vi.fn();
    const stop = onSessionEnded(ended);
    scriptFetch(expired, [401, { error: { code: 'REFRESH_TOKEN_EXPIRED', message: 'Session has expired' } }]);
    await expect(request('/thing')).rejects.toMatchObject({ code: 'REFRESH_TOKEN_EXPIRED' });
    expect(ended).toHaveBeenCalledWith('expired');
    stop();
  });

  it("turns the backend's error shape into an ApiError with code, details and request id", async () => {
    scriptFetch([400, { error: { status: 400, code: 'VALIDATION_ERROR', message: 'Invalid', details: [{ field: 'from', message: 'bad' }], requestId: 'req-1' } }]);
    const err = await request('/thing').catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 400, code: 'VALIDATION_ERROR', requestId: 'req-1', details: [{ field: 'from', message: 'bad' }] });
  });

  it('a non-JSON error (e.g. a proxy page) still becomes an ApiError', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<html>Bad gateway</html>', { status: 502 })));
    await expect(request('/thing')).rejects.toMatchObject({ status: 502, code: 'HTTP_ERROR' });
  });

  it('logged-out requests (login) send no token', async () => {
    const calls = scriptFetch([200, { ok: true }]);
    await request('/auth/login', { method: 'POST', body: { a: 1 }, auth: false, credentials: 'include' });
    expect(calls[0].headers.Authorization).toBeUndefined();
    expect(calls[0].body).toBe('{"a":1}');
  });
});

describe('refreshSession()', () => {
  it('stores the new token for the next request', async () => {
    clearSession();
    const calls = scriptFetch(refreshed, [200, { ok: true }]);
    await refreshSession();
    await request('/thing');
    expect(calls[1].headers.Authorization).toBe('Bearer new-token');
  });
});
