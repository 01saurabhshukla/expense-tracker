// Duplicate handling end to end: overlapping statements and re-uploading a
// failed file. Needs the real Supabase database and the local Redis.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isolateTestEnv, waitForUpload } from './helpers/testEnv.js';

const testEnv = await isolateTestEnv('dedupe-test');

const { createApp } = await import('../src/app.js');
const { pool } = await import('../src/db/pool.js');
const { startUploadWorker } = await import('../src/jobs/worker.js');

const TEST_DOMAIN = '@dedupe.example.test';
const FIXTURES = fileURLToPath(new URL('./fixtures/statements/', import.meta.url));

let server;
let baseUrl;
let worker;
const alice = {};
const bob = {};

before(async () => {
  server = createApp().listen(0);
  baseUrl = `http://localhost:${server.address().port}`;

  for (const person of [alice, bob]) {
    const credentials = { email: `user-${randomUUID()}${TEST_DOMAIN}`, password: 'correct-horse' };
    await postJson('/auth/signup', { ...credentials, name: 'Dedupe Test' });
    const login = await (await postJson('/auth/login', credentials)).json();
    person.token = login.accessToken;
    person.id = login.user.id;
  }

  worker = await startUploadWorker();
});

after(async () => {
  await worker?.close();
  await pool.query('DELETE FROM users WHERE email LIKE $1', [`%${TEST_DOMAIN}`]);
  await testEnv.cleanup();
  await pool.end();
  server.close();
});

function postJson(urlPath, body) {
  return fetch(`${baseUrl}${urlPath}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function upload(person, name, content) {
  const form = new FormData();
  form.append('file', new Blob([content ?? (await readFile(path.join(FIXTURES, name)))]), name);
  const res = await fetch(`${baseUrl}/uploads`, {
    method: 'POST',
    headers: { authorization: `Bearer ${person.token}` },
    body: form,
  });
  return { status: res.status, body: await res.json() };
}

async function uploadAndWait(person, name) {
  const { status, body } = await upload(person, name);
  assert.equal(status, 201, JSON.stringify(body));
  return (await waitForUpload(baseUrl, person.token, body.upload.id)).upload;
}

async function transactionCount(person) {
  const { rows } = await pool.query('SELECT count(*)::int AS n FROM transactions WHERE user_id = $1', [person.id]);
  return rows[0].n;
}

test('overlapping statements: the shared 15–30 Sep rows are stored once', async () => {
  const september = await uploadAndWait(alice, 'hdfc_sep2026.csv');
  assert.equal(september.progress.transactionsSaved, 54);
  assert.equal(september.progress.duplicatesSkipped, 0);

  const overlap = await uploadAndWait(alice, 'edge_hdfc_overlap_15sep_06oct.csv');
  assert.equal(overlap.stage, 'completed');
  assert.equal(overlap.progress.transactionsFound, 42);
  assert.equal(overlap.progress.transactionsSaved, 12); // only 1–6 Oct is new
  assert.equal(overlap.progress.duplicatesSkipped, 30);

  assert.equal(await transactionCount(alice), 66);
});

test('both genuine ₹20 CHAI POINT payments on 10 Sep are kept', async () => {
  const { rows } = await pool.query(
    `SELECT count(*)::int AS n FROM transactions
     WHERE user_id = $1 AND date = '2026-09-10' AND amount_paise = 2000 AND description LIKE '%CHAI POINT%'`,
    [alice.id],
  );
  assert.equal(rows[0].n, 2);
});

test("another user's identical statement is not a duplicate of Alice's", async () => {
  const bobsSeptember = await uploadAndWait(bob, 'hdfc_sep2026.csv');
  assert.equal(bobsSeptember.progress.transactionsSaved, 54);
  assert.equal(await transactionCount(bob), 54);
  assert.equal(await transactionCount(alice), 66);
});

test('reprocessing a statement keeps the totals the same', async () => {
  const { rows } = await pool.query(
    "SELECT id FROM uploads WHERE user_id = $1 AND original_filename = 'hdfc_sep2026.csv'",
    [alice.id],
  );
  await pool.query("UPDATE uploads SET stage = 'queued' WHERE id = $1", [rows[0].id]);
  const { processUpload } = await import('../src/jobs/processUpload.js');
  await processUpload(rows[0].id);

  assert.equal(await transactionCount(alice), 66);
});

test('a file whose processing failed can be uploaded again', async () => {
  const content = 'Name,Email\nNot,A Statement\n';

  const first = await upload(alice, 'not-a-statement.csv', content);
  assert.equal(first.status, 201);
  const failed = await waitForUpload(baseUrl, alice.token, first.body.upload.id);
  assert.equal(failed.upload.stage, 'failed');

  // Same bytes again → accepted as a new upload, not 409.
  const second = await upload(alice, 'not-a-statement.csv', content);
  assert.equal(second.status, 201);
  assert.notEqual(second.body.upload.id, first.body.upload.id);
  await waitForUpload(baseUrl, alice.token, second.body.upload.id);
});

test('a file that did NOT fail is still a 409 duplicate', async () => {
  const again = await upload(alice, 'hdfc_sep2026.csv');
  assert.equal(again.status, 409);
  assert.equal(again.body.error.code, 'DUPLICATE_FILE');
});
