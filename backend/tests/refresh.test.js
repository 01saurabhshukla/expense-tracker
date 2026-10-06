// Runs against the real Supabase database. Deleting the test users also
// deletes their refresh tokens (ON DELETE CASCADE).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createApp } from '../src/app.js';
import { pool } from '../src/db/pool.js';
import { hashRefreshToken } from '../src/services/tokens.js';

const TEST_DOMAIN = '@refresh.example.test';
const PASSWORD = 'correct-horse';

let server;
let baseUrl;
let email;

before(async () => {
  server = createApp().listen(0);
  baseUrl = `http://localhost:${server.address().port}`;

  email = `user-${randomUUID()}${TEST_DOMAIN}`;
  await post('/auth/signup', { body: { email, password: PASSWORD, name: 'Refresh Test' } });
});

after(async () => {
  await pool.query('DELETE FROM users WHERE email LIKE $1', [`%${TEST_DOMAIN}`]);
  await pool.end();
  server.close();
});

function post(path, { body, cookie } = {}) {
  const headers = {};
  if (body) headers['content-type'] = 'application/json';
  if (cookie) headers.cookie = `refresh_token=${cookie}`;
  return fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
}

// Plays the browser's role: reads the refresh_token cookie the server set.
function refreshCookieFrom(res) {
  const header = res.headers.getSetCookie().find((c) => c.startsWith('refresh_token='));
  return { header, value: header?.split(';')[0].split('=')[1] };
}

async function login() {
  const res = await post('/auth/login', { body: { email, password: PASSWORD } });
  return { res, body: await res.json(), cookie: refreshCookieFrom(res) };
}

test('login sets an httpOnly refresh cookie and keeps the token out of the body', async () => {
  const { res, body, cookie } = await login();

  assert.equal(res.status, 200);
  assert.equal(body.refreshToken, undefined);
  assert.ok(cookie.value);
  assert.match(cookie.header, /HttpOnly/);
  assert.match(cookie.header, /Path=\/auth/);
  assert.match(cookie.header, /SameSite=Lax/);
});

test('refresh returns a new access token and rotates the cookie', async () => {
  const { cookie: first } = await login();

  const res = await post('/auth/refresh', { cookie: first.value });
  const body = await res.json();
  const second = refreshCookieFrom(res);

  assert.equal(res.status, 200);
  assert.ok(body.accessToken);
  assert.ok(second.value);
  assert.notEqual(second.value, first.value);

  const me = await fetch(`${baseUrl}/auth/me`, {
    headers: { authorization: `Bearer ${body.accessToken}` },
  });
  assert.equal(me.status, 200);
});

test('reusing an old refresh token revokes the whole session', async () => {
  const { cookie: first } = await login();
  const rotated = refreshCookieFrom(await post('/auth/refresh', { cookie: first.value }));

  // Attacker (or anyone) replays the already-used token.
  const replay = await post('/auth/refresh', { cookie: first.value });
  assert.equal(replay.status, 401);
  assert.equal((await replay.json()).error.code, 'REFRESH_TOKEN_REUSED');

  // The legitimate, newer token is now dead too.
  const legit = await post('/auth/refresh', { cookie: rotated.value });
  assert.equal(legit.status, 401);
});

test('refresh without a cookie → 401 UNAUTHENTICATED', async () => {
  const res = await post('/auth/refresh');
  assert.equal(res.status, 401);
  assert.equal((await res.json()).error.code, 'UNAUTHENTICATED');
});

test('refresh with an unknown token → 401 and clears the cookie', async () => {
  const res = await post('/auth/refresh', { cookie: 'made-up-token' });
  assert.equal(res.status, 401);
  assert.equal((await res.json()).error.code, 'INVALID_REFRESH_TOKEN');
  assert.match(refreshCookieFrom(res).header, /Expires=Thu, 01 Jan 1970/);
});

test('an expired refresh token → 401 REFRESH_TOKEN_EXPIRED', async () => {
  const { cookie } = await login();
  await pool.query(
    "UPDATE refresh_tokens SET expires_at = now() - interval '1 minute' WHERE token_hash = $1",
    [hashRefreshToken(cookie.value)],
  );

  const res = await post('/auth/refresh', { cookie: cookie.value });
  assert.equal(res.status, 401);
  assert.equal((await res.json()).error.code, 'REFRESH_TOKEN_EXPIRED');
});

test('logout → 204, clears the cookie, and the token stops working', async () => {
  const { cookie } = await login();

  const res = await post('/auth/logout', { cookie: cookie.value });
  assert.equal(res.status, 204);
  assert.match(refreshCookieFrom(res).header, /Expires=Thu, 01 Jan 1970/);

  const after = await post('/auth/refresh', { cookie: cookie.value });
  assert.equal(after.status, 401);
});

test('the database stores only a hash, never the raw token', async () => {
  const { cookie } = await login();

  const raw = await pool.query('SELECT 1 FROM refresh_tokens WHERE token_hash = $1', [cookie.value]);
  const hashed = await pool.query('SELECT 1 FROM refresh_tokens WHERE token_hash = $1', [
    hashRefreshToken(cookie.value),
  ]);

  assert.equal(raw.rowCount, 0);
  assert.equal(hashed.rowCount, 1);
});
