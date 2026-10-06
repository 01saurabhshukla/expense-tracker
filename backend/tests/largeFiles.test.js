// Large statements (7i): many batches in one streaming pass, all-or-nothing
// on failure, row errors capped. Needs the real Supabase database and the
// local Redis.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { isolateTestEnv, waitForUpload } from './helpers/testEnv.js';
import { hdfcStatementCsv, badRows } from './helpers/statements.js';

const testEnv = await isolateTestEnv('large-files-test');

const { createApp } = await import('../src/app.js');
const { pool } = await import('../src/db/pool.js');
const { startUploadWorker } = await import('../src/jobs/worker.js');
const { IMPORT_BATCH_SIZE } = await import('../src/jobs/processUpload.js');

const TEST_DOMAIN = '@large-files.example.test';

let server;
let baseUrl;
let token;
let worker;

before(async () => {
  server = createApp().listen(0);
  baseUrl = `http://localhost:${server.address().port}`;
  const credentials = { email: `user-${randomUUID()}${TEST_DOMAIN}`, password: 'correct-horse' };
  await postJson('/auth/signup', { ...credentials, name: 'Large Files Test' });
  token = (await (await postJson('/auth/login', credentials)).json()).accessToken;
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

async function uploadAndWait(csv, name) {
  const form = new FormData();
  form.append('file', new Blob([csv]), name);
  const res = await fetch(`${baseUrl}/uploads`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}` },
    body: form,
  });
  const body = await res.json();
  assert.equal(res.status, 201, JSON.stringify(body));
  return (await waitForUpload(baseUrl, token, body.upload.id, { timeoutMs: 120_000 })).upload;
}

async function countRows(uploadId) {
  const { rows } = await pool.query('SELECT count(*)::int AS n FROM transactions WHERE upload_id = $1', [uploadId]);
  return rows[0].n;
}

test('a statement spanning many batches is imported completely and adds up', async () => {
  const rows = IMPORT_BATCH_SIZE * 5 + 123; // several full batches + a partial one
  const upload = await uploadAndWait(hdfcStatementCsv(rows, { seed: 1 }), 'many-batches.csv');

  assert.equal(upload.stage, 'completed', JSON.stringify(upload.error));
  assert.equal(upload.progress.transactionsFound, rows);
  assert.equal(upload.progress.transactionsSaved, rows);
  assert.equal(upload.progress.percent, 100);
  assert.equal(await countRows(upload.id), rows);
  // The streamed summary saw every row, in order, across batch boundaries.
  assert.equal(upload.summary.totals.count, rows);
  assert.equal(upload.summary.balance.status, 'ok');
  assert.equal(upload.summary.balance.checkedRows, rows - 1);
});

test('a file that breaks after thousands of rows were inserted leaves NOTHING behind', async () => {
  // 3,500 good rows (3 batches already inserted), then a quote that never closes.
  const csv = `${hdfcStatementCsv(3500, { seed: 2 })}01/01/2024,"UNCLOSED QUOTE,REF,01/01/2024,1.00,,1.00\n`;
  const upload = await uploadAndWait(csv, 'breaks-at-the-end.csv');

  assert.equal(upload.stage, 'failed');
  assert.equal(upload.error.code, 'MALFORMED_CSV');
  assert.equal(upload.summary, null);
  assert.equal(await countRows(upload.id), 0); // the transaction rolled back
});

test('row errors: all are counted, the first 100 are kept', async () => {
  const csv = hdfcStatementCsv(10, { seed: 3 }) + badRows(1500);
  const upload = await uploadAndWait(csv, 'many-bad-rows.csv');

  assert.equal(upload.stage, 'completed');
  assert.equal(upload.progress.transactionsSaved, 10);
  assert.equal(upload.progress.rowErrors, 1500);
  assert.equal(upload.rowErrors.length, 100);
  assert.equal(upload.rowErrors[0].line, 12); // header is line 1, 10 good rows, then the bad ones
});

test('a file of only bad rows fails as a whole, reporting the total', async () => {
  const csv = hdfcStatementCsv(0) + badRows(250);
  const upload = await uploadAndWait(csv, 'only-bad-rows.csv');

  assert.equal(upload.stage, 'failed');
  assert.equal(upload.error.code, 'NO_VALID_TRANSACTIONS');
  assert.match(upload.error.message, /None of the 250 rows/);
  assert.equal(upload.rowErrors.length, 20);
});
