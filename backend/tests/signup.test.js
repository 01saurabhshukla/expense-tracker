// Runs against the real Supabase database. Every test user has an
// @example.test email and is deleted when this file finishes.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createApp } from '../src/app.js';
import { pool } from '../src/db/pool.js';

// Own subdomain so this file's cleanup can't delete another test file's users
// (node --test runs files in parallel).
const TEST_DOMAIN = '@signup.example.test';

let server;
let baseUrl;

before(() => {
  server = createApp().listen(0);
  baseUrl = `http://localhost:${server.address().port}`;
});

after(async () => {
  await pool.query('DELETE FROM users WHERE email LIKE $1', [`%${TEST_DOMAIN}`]);
  await pool.end();
  server.close();
});

function uniqueEmail() {
  return `user-${randomUUID()}${TEST_DOMAIN}`;
}

function signup(body) {
  return fetch(`${baseUrl}/auth/signup`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

test('creates a user, returns 201, never returns the password hash', async () => {
  const email = uniqueEmail();
  const res = await signup({ email: `  ${email.toUpperCase()} `, password: 'longenough', name: 'Test' });
  const body = await res.json();

  assert.equal(res.status, 201);
  assert.equal(body.user.email, email);
  assert.ok(body.user.id);
  assert.equal(body.user.passwordHash, undefined);
  assert.equal(body.user.password_hash, undefined);

  const { rows } = await pool.query('SELECT password_hash FROM users WHERE id = $1', [body.user.id]);
  assert.match(rows[0].password_hash, /^\$2b\$12\$/);
});

test('rejects a duplicate email with 409, regardless of case', async () => {
  const email = uniqueEmail();
  await signup({ email, password: 'longenough', name: 'First' });

  const res = await signup({ email: email.toUpperCase(), password: 'different1', name: 'Second' });
  const body = await res.json();

  assert.equal(res.status, 409);
  assert.equal(body.error.code, 'EMAIL_TAKEN');
});

test('rejects a password over 72 bytes even if under 72 characters', async () => {
  const res = await signup({ email: uniqueEmail(), password: 'पासवर्ड'.repeat(4), name: 'Test' });
  const body = await res.json();

  assert.equal(res.status, 400);
  assert.equal(body.error.details[0].field, 'password');
});
