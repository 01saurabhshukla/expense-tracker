// CORS: only the configured frontend origins may call the API from a browser.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const FRONTEND = 'https://app.example.test';
const DEV_FRONTEND = 'http://localhost:5173';
process.env.CORS_ORIGINS = `${FRONTEND}, ${DEV_FRONTEND}`; // before the app reads env

const { createApp } = await import('../src/app.js');
const { pool } = await import('../src/db/pool.js');

let server;
let baseUrl;

before(() => {
  server = createApp().listen(0);
  baseUrl = `http://localhost:${server.address().port}`;
});

after(async () => {
  server.close();
  await pool.end();
});

function call(path, { method = 'GET', origin, headers = {} } = {}) {
  return fetch(`${baseUrl}${path}`, { method, headers: { ...(origin && { origin }), ...headers } });
}

test('no Origin (curl, server-to-server): works, no CORS headers', async () => {
  const res = await call('/health');
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('access-control-allow-origin'), null);
});

test('the frontend origin is allowed, with credentials and readable headers', async () => {
  for (const origin of [FRONTEND, DEV_FRONTEND]) {
    const res = await call('/health', { origin });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('access-control-allow-origin'), origin);
    assert.equal(res.headers.get('access-control-allow-credentials'), 'true');
    assert.match(res.headers.get('access-control-expose-headers'), /X-Request-Id/);
    assert.match(res.headers.get('vary'), /Origin/);
  }
});

test('any other origin is refused outright', async () => {
  for (const origin of ['https://evil.example', 'https://app.example.test.evil.example', 'http://app.example.test', 'null']) {
    const res = await call('/health', { origin });
    assert.equal(res.status, 403, origin);
    assert.equal(res.headers.get('access-control-allow-origin'), null, origin);
    assert.equal((await res.json()).error.code, 'CORS_ORIGIN_NOT_ALLOWED');
  }
});

test('preflight: allowed origin gets methods and headers, without needing a login', async () => {
  const res = await call('/transactions/123', {
    method: 'OPTIONS',
    origin: FRONTEND,
    headers: { 'access-control-request-method': 'PATCH', 'access-control-request-headers': 'authorization, content-type' },
  });
  assert.equal(res.status, 204);
  assert.equal(res.headers.get('access-control-allow-origin'), FRONTEND);
  assert.match(res.headers.get('access-control-allow-methods'), /PATCH/);
  assert.match(res.headers.get('access-control-allow-headers'), /Authorization/);
  assert.equal(res.headers.get('access-control-max-age'), '600');
});

test('preflight from another origin is refused', async () => {
  const res = await call('/transactions', {
    method: 'OPTIONS',
    origin: 'https://evil.example',
    headers: { 'access-control-request-method': 'GET' },
  });
  assert.equal(res.status, 403);
});

test('errors carry CORS headers too, so the frontend can read TOKEN_EXPIRED', async () => {
  const res = await call('/transactions', { origin: FRONTEND });
  assert.equal(res.status, 401);
  assert.equal(res.headers.get('access-control-allow-origin'), FRONTEND);
  assert.equal((await res.json()).error.code, 'UNAUTHENTICATED');
});

// ---------- configuration ----------

const run = promisify(execFile);

async function loadEnv(overrides) {
  const env = { PATH: process.env.PATH, DATABASE_URL: 'postgres://u:p@localhost/db', JWT_ACCESS_SECRET: 'x'.repeat(32), ...overrides };
  try {
    const { stdout } = await run(process.execPath, ['--input-type=module', '-e', "const { env } = await import('./src/config/env.js'); console.log(JSON.stringify(env.CORS_ORIGINS))"], { env });
    return { origins: JSON.parse(stdout) };
  } catch (err) {
    return { error: err.stderr };
  }
}

test('config: required in production, defaults to the Vite dev server otherwise, origins only', async () => {
  assert.match((await loadEnv({ NODE_ENV: 'production' })).error, /CORS_ORIGINS: is required in production/);
  assert.deepEqual((await loadEnv({ NODE_ENV: 'development' })).origins, ['http://localhost:5173']);
  assert.deepEqual((await loadEnv({ NODE_ENV: 'production', CORS_ORIGINS: 'https://a.example, https://b.example:8443' })).origins, ['https://a.example', 'https://b.example:8443']);
  assert.match((await loadEnv({ CORS_ORIGINS: 'https://a.example/' })).error, /must be an origin/);
  assert.match((await loadEnv({ CORS_ORIGINS: 'https://a.example/app' })).error, /must be an origin/);
});
