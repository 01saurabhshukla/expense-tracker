// Runs against the real Supabase database, with files in a throwaway folder.
// Two users: Alice uploads 3 files, Bob uploads 1. Each must see only their own.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { isolateTestEnv } from './helpers/testEnv.js';

const testEnv = await isolateTestEnv('uploads-list-test');

const { createApp } = await import('../src/app.js');
const { pool } = await import('../src/db/pool.js');

const TEST_DOMAIN = '@uploadslist.example.test';

let server;
let baseUrl;
const alice = { uploads: [] };
const bob = { uploads: [] };

before(async () => {
  server = createApp().listen(0);
  baseUrl = `http://localhost:${server.address().port}`;

  for (const person of [alice, bob]) {
    const credentials = { email: `user-${randomUUID()}${TEST_DOMAIN}`, password: 'correct-horse' };
    await postJson('/auth/signup', { ...credentials, name: 'List Test' });
    person.token = (await (await postJson('/auth/login', credentials)).json()).accessToken;
  }

  // Sequential, so created_at order is known: alice.uploads[2] is the newest.
  for (let i = 0; i < 3; i++) alice.uploads.push(await uploadFor(alice, `alice-${i}.csv`));
  bob.uploads.push(await uploadFor(bob, 'bob-0.csv'));
});

after(async () => {
  await pool.query('DELETE FROM users WHERE email LIKE $1', [`%${TEST_DOMAIN}`]);
  await pool.end();
  server.close();
  await testEnv.cleanup();
});

function postJson(urlPath, body) {
  return fetch(`${baseUrl}${urlPath}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function uploadFor(person, filename) {
  const form = new FormData();
  form.append('file', new Blob([`a,b\n${randomUUID()}\n`]), filename);
  const res = await fetch(`${baseUrl}/uploads`, {
    method: 'POST',
    headers: { authorization: `Bearer ${person.token}` },
    body: form,
  });
  return (await res.json()).upload;
}

function get(person, urlPath) {
  const headers = person ? { authorization: `Bearer ${person.token}` } : {};
  return fetch(`${baseUrl}${urlPath}`, { headers });
}

test('GET /uploads lists only my uploads, newest first', async () => {
  const res = await get(alice, '/uploads');
  const body = await res.json();

  assert.equal(res.status, 200);
  assert.deepEqual(
    body.uploads.map((u) => u.originalFilename),
    ['alice-2.csv', 'alice-1.csv', 'alice-0.csv'],
  );
  assert.deepEqual(body.pagination, { limit: 20, offset: 0, hasMore: false });
});

test('pagination: limit + offset walk through every upload exactly once', async () => {
  const page1 = await (await get(alice, '/uploads?limit=2')).json();
  const page2 = await (await get(alice, '/uploads?limit=2&offset=2')).json();

  assert.equal(page1.uploads.length, 2);
  assert.equal(page1.pagination.hasMore, true);
  assert.equal(page2.uploads.length, 1);
  assert.equal(page2.pagination.hasMore, false);

  const seen = [...page1.uploads, ...page2.uploads].map((u) => u.id).sort();
  assert.deepEqual(seen, alice.uploads.map((u) => u.id).sort());
});

test('invalid query parameters → 400 VALIDATION_ERROR', async () => {
  for (const query of ['limit=0', 'limit=101', 'limit=abc', 'offset=-1']) {
    const res = await get(alice, `/uploads?${query}`);
    assert.equal(res.status, 400, query);
    assert.equal((await res.json()).error.code, 'VALIDATION_ERROR');
  }
});

test('GET /uploads/:id returns my upload, without any storage details', async () => {
  const mine = alice.uploads[0];
  const res = await get(alice, `/uploads/${mine.id}`);
  const body = await res.json();

  assert.equal(res.status, 200);
  // The single-upload view adds the row errors and the summary to what the
  // list shows. No worker runs in this file, so there's no summary yet.
  const { rowErrors, summary, ...rest } = body.upload;
  assert.deepEqual(rest, mine);
  assert.deepEqual(rowErrors, []);
  assert.equal(summary, null);
  assert.equal(body.upload.storagePath, undefined);
  assert.equal(body.upload.sha256, undefined);
});

test("someone else's upload, a missing id and a malformed id all get the same 404", async () => {
  const responses = await Promise.all([
    get(alice, `/uploads/${bob.uploads[0].id}`),
    get(alice, `/uploads/${randomUUID()}`),
    get(alice, '/uploads/not-a-uuid'),
  ]);

  const errors = [];
  for (const res of responses) {
    assert.equal(res.status, 404);
    const { error } = await res.json();
    errors.push({ code: error.code, message: error.message });
  }
  assert.deepEqual(errors[0], { code: 'UPLOAD_NOT_FOUND', message: 'Upload not found' });
  assert.deepEqual(errors[1], errors[0]);
  assert.deepEqual(errors[2], errors[0]);
});

test('Bob sees only his own upload', async () => {
  const body = await (await get(bob, '/uploads')).json();
  assert.deepEqual(body.uploads.map((u) => u.id), [bob.uploads[0].id]);
});

test('no token → 401 on both read routes', async () => {
  assert.equal((await get(null, '/uploads')).status, 401);
  assert.equal((await get(null, `/uploads/${alice.uploads[0].id}`)).status, 401);
});
