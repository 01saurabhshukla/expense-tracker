// Runs against the real Supabase database. Test users are deleted afterwards.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { createApp } from '../src/app.js';
import { pool } from '../src/db/pool.js';
import { env } from '../src/config/env.js';

const TEST_DOMAIN = '@login.example.test';
const PASSWORD = 'correct-horse';

let server;
let baseUrl;
let user;

before(async () => {
  server = createApp().listen(0);
  baseUrl = `http://localhost:${server.address().port}`;

  const email = `user-${randomUUID()}${TEST_DOMAIN}`;
  const res = await postJson('/auth/signup', { email, password: PASSWORD, name: 'Login Test' });
  user = (await res.json()).user;
});

after(async () => {
  await pool.query('DELETE FROM users WHERE email LIKE $1', [`%${TEST_DOMAIN}`]);
  await pool.end();
  server.close();
});

function postJson(path, body) {
  return fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function getMe(token) {
  const headers = token ? { authorization: `Bearer ${token}` } : {};
  return fetch(`${baseUrl}/auth/me`, { headers });
}

test('login with correct password returns an access token', async () => {
  const res = await postJson('/auth/login', { email: user.email, password: PASSWORD });
  const body = await res.json();

  assert.equal(res.status, 200);
  assert.equal(body.user.id, user.id);
  assert.equal(body.user.passwordHash, undefined);
  assert.equal(body.expiresIn, 900);

  const payload = jwt.decode(body.accessToken);
  assert.equal(payload.sub, user.id);
  assert.equal(payload.exp - payload.iat, 900);
});

test('wrong password and unknown email get the identical response', async () => {
  const wrongPassword = await postJson('/auth/login', { email: user.email, password: 'nope-nope' });
  const unknownEmail = await postJson('/auth/login', { email: `ghost${TEST_DOMAIN}`, password: PASSWORD });

  const a = (await wrongPassword.json()).error;
  const b = (await unknownEmail.json()).error;

  assert.equal(wrongPassword.status, 401);
  assert.equal(unknownEmail.status, 401);
  assert.equal(a.code, 'INVALID_CREDENTIALS');
  assert.equal(a.message, b.message);
  assert.equal(a.code, b.code);
});

test('GET /auth/me returns the user for a valid token', async () => {
  const login = await postJson('/auth/login', { email: user.email, password: PASSWORD });
  const { accessToken } = await login.json();

  const res = await getMe(accessToken);
  const body = await res.json();

  assert.equal(res.status, 200);
  assert.equal(body.user.id, user.id);
});

test('GET /auth/me without a token → 401 UNAUTHENTICATED', async () => {
  const res = await getMe();
  assert.equal(res.status, 401);
  assert.equal((await res.json()).error.code, 'UNAUTHENTICATED');
});

test('GET /auth/me with an expired token → 401 TOKEN_EXPIRED', async () => {
  const expired = jwt.sign({}, env.JWT_ACCESS_SECRET, { subject: user.id, expiresIn: -10 });
  const res = await getMe(expired);
  assert.equal(res.status, 401);
  assert.equal((await res.json()).error.code, 'TOKEN_EXPIRED');
});

test('GET /auth/me with a token signed by another secret → 401 INVALID_TOKEN', async () => {
  const forged = jwt.sign({}, 'attacker-secret-attacker-secret-1234', { subject: user.id, expiresIn: 60 });
  const res = await getMe(forged);
  assert.equal(res.status, 401);
  assert.equal((await res.json()).error.code, 'INVALID_TOKEN');
});

test('GET /auth/me with an unsigned "alg: none" token → 401 INVALID_TOKEN', async () => {
  const unsigned = jwt.sign({ sub: user.id }, null, { algorithm: 'none' });
  const res = await getMe(unsigned);
  assert.equal(res.status, 401);
  assert.equal((await res.json()).error.code, 'INVALID_TOKEN');
});
