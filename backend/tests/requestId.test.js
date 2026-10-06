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

test('generates a request id when none is sent', async () => {
  const res = await fetch(`${baseUrl}/health`);
  assert.match(res.headers.get('x-request-id'), /^[0-9a-f-]{36}$/);
});

test('reuses a safe incoming request id', async () => {
  const res = await fetch(`${baseUrl}/health`, {
    headers: { 'x-request-id': 'abc-123' },
  });
  assert.equal(res.headers.get('x-request-id'), 'abc-123');
});

test('replaces an unsafe incoming request id', async () => {
  const res = await fetch(`${baseUrl}/health`, {
    headers: { 'x-request-id': 'bad id with spaces' },
  });
  assert.notEqual(res.headers.get('x-request-id'), 'bad id with spaces');
});
