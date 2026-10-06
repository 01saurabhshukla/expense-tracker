import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';

let server;
let baseUrl;

before(() => {
  server = createApp().listen(0);
  baseUrl = `http://localhost:${server.address().port}`;
});

after(() => server.close());

function postJson(path, body) {
  return fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

test('rejects invalid fields with 400 and lists each problem', async () => {
  const res = await postJson('/auth/signup', { email: 'not-an-email', password: 'short' });
  const body = await res.json();

  assert.equal(res.status, 400);
  assert.equal(body.error.code, 'VALIDATION_ERROR');
  const fields = body.error.details.map((d) => d.field).sort();
  assert.deepEqual(fields, ['email', 'name', 'password']);
  assert.ok(body.error.requestId);
});

test('rejects malformed JSON with 400', async () => {
  const res = await postJson('/auth/signup', '{"email": ');
  const body = await res.json();

  assert.equal(res.status, 400);
  assert.equal(body.error.code, 'MALFORMED_JSON');
});

test('unknown routes return a JSON 404', async () => {
  const res = await fetch(`${baseUrl}/nope`);
  const body = await res.json();

  assert.equal(res.status, 404);
  assert.equal(body.error.status, 404);
  assert.equal(body.error.code, 'NOT_FOUND');
});
