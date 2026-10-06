// Background processing end to end: upload → BullMQ → worker → transactions,
// observed only through the API, exactly like the frontend will poll it.
// Needs the real Supabase database and the local Redis.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isolateTestEnv, waitForUpload } from './helpers/testEnv.js';

// Fast retries so the "gives up after 3 attempts" test takes milliseconds.
const testEnv = await isolateTestEnv('processing-test', { JOB_BACKOFF_MS: '10' });

const { createApp } = await import('../src/app.js');
const { pool } = await import('../src/db/pool.js');
const { startUploadWorker } = await import('../src/jobs/worker.js');
const { processUpload } = await import('../src/jobs/processUpload.js');

const TEST_DOMAIN = '@processing.example.test';
const FIXTURES = fileURLToPath(new URL('./fixtures/statements/', import.meta.url));

let server;
let baseUrl;
let token;
let userId;
let worker;

before(async () => {
  server = createApp().listen(0);
  baseUrl = `http://localhost:${server.address().port}`;

  const credentials = { email: `user-${randomUUID()}${TEST_DOMAIN}`, password: 'correct-horse' };
  await postJson('/auth/signup', { ...credentials, name: 'Processing Test' });
  const login = await (await postJson('/auth/login', credentials)).json();
  token = login.accessToken;
  userId = login.user.id;

  worker = await startUploadWorker();
});

after(async () => {
  await worker?.close();
  await pool.query('DELETE FROM users WHERE email LIKE $1', [`%${TEST_DOMAIN}`]);
  await testEnv.cleanup();
  await pool.end();
  server.close();
});

// ---------- helpers ----------

function postJson(urlPath, body) {
  return fetch(`${baseUrl}${urlPath}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function uploadFixture(name) {
  const form = new FormData();
  form.append('file', new Blob([await readFile(path.join(FIXTURES, name))]), name);
  const res = await fetch(`${baseUrl}/uploads`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}` },
    body: form,
  });
  const body = await res.json();
  assert.equal(res.status, 201, `${name}: ${JSON.stringify(body)}`);
  return body.upload;
}

async function processFixture(name) {
  const created = await uploadFixture(name);
  assert.equal(created.stage, 'queued'); // the upload request never waits for parsing
  return { created, ...(await waitForUpload(baseUrl, token, created.id)) };
}

async function transactionsFor(uploadId) {
  const { rows } = await pool.query(
    `SELECT user_id, line, date::text, direction, amount_paise::int AS amount, balance_paise::int AS balance
     FROM transactions WHERE upload_id = $1 ORDER BY line`,
    [uploadId],
  );
  return rows;
}

// ---------- tests ----------

test('HDFC statement: queued → … → completed, all 54 transactions saved', async () => {
  const { upload, stagesSeen } = await processFixture('hdfc_sep2026.csv');

  assert.equal(upload.stage, 'completed', JSON.stringify(upload.error));
  assert.equal(stagesSeen.at(-1), 'completed');
  assert.equal(upload.error, null);
  assert.ok(upload.startedAt && upload.finishedAt);
  assert.deepEqual(upload.progress, {
    rowsRead: 55, // 54 transactions + the footer
    transactionsFound: 54,
    transactionsSaved: 54,
    duplicatesSkipped: 0,
    rowErrors: 0,
    skippedRows: 1,
    categorizedBy: { user: 0, rule: 54, none: 0 },
  });
  assert.deepEqual(upload.rowErrors, []);

  const rows = await transactionsFor(upload.id);
  assert.equal(rows.length, 54);
  assert.ok(rows.every((row) => row.user_id === userId));
  assert.deepEqual(rows[0], {
    user_id: userId, line: 7, date: '2026-09-01', direction: 'debit', amount: 93645, balance: 4731355,
  });

  // The summary describes the statement; every running balance adds up.
  const { summary } = upload;
  assert.deepEqual(summary.period, { from: '2026-09-01', to: '2026-09-30' });
  assert.deepEqual(summary.totals, { count: 54, debitPaise: 8645103, creditPaise: 8891255, netPaise: 246152 });
  assert.deepEqual(summary.byMonth.map((m) => m.month), ['2026-09']);
  assert.equal(summary.byCategory.reduce((n, c) => n + c.count, 0), 54);
  assert.equal(summary.balance.status, 'ok');
  assert.equal(summary.balance.checkedRows, 53);
  assert.equal(summary.balance.openingPaise, 4825000); // ₹48,250.00
  assert.equal(summary.balance.closingPaise, 5071152);
});

test('every bank format is processed to completion', async () => {
  const expected = { 'sbi_sep2026.csv': 56, 'icici_sep2026.csv': 53, 'axis_sep2026.csv': 46, 'kotak_sep2026.csv': 47 };
  const results = await Promise.all(Object.keys(expected).map((name) => processFixture(name)));

  for (const [i, name] of Object.keys(expected).entries()) {
    const { upload } = results[i];
    assert.equal(upload.stage, 'completed', `${name}: ${JSON.stringify(upload.error)}`);
    assert.equal(upload.progress.transactionsSaved, expected[name], name);
    assert.equal((await transactionsFor(upload.id)).length, expected[name], name);
    // Every bank's running balance adds up: no row lost or misread.
    assert.equal(upload.summary.balance.status, 'ok', `${name}: ${JSON.stringify(upload.summary.balance)}`);
  }
});

test('malformed rows: good rows saved, each bad row reported to the user', async () => {
  const { upload } = await processFixture('edge_malformed_rows.csv');

  assert.equal(upload.stage, 'completed');
  assert.equal(upload.progress.transactionsSaved, 3);
  assert.equal(upload.progress.rowErrors, 7);
  assert.deepEqual(upload.rowErrors.map((e) => e.line), [3, 4, 5, 6, 7, 11, 12]);
  assert.ok(upload.rowErrors.every((e) => e.code && e.message));
  assert.deepEqual((await transactionsFor(upload.id)).map((t) => t.line), [2, 9, 13]);

  // The rejected rows leave gaps, and the balance check points at them.
  assert.equal(upload.summary.balance.status, 'mismatch');
  assert.deepEqual(upload.summary.balance.mismatches.map((m) => m.line), [9, 13]);
});

test('files that are not statements fail with a reason the user can read', async () => {
  for (const [name, code] of [
    ['edge_unrecognized_format.csv', 'UNRECOGNIZED_FORMAT'],
    ['edge_corrupt_binary.csv', 'UNRECOGNIZED_FORMAT'],
    ['edge_header_only.csv', 'NO_VALID_TRANSACTIONS'],
  ]) {
    const { upload } = await processFixture(name);
    assert.equal(upload.stage, 'failed', name);
    assert.equal(upload.error.code, code, name);
    assert.ok(upload.error.message.length > 10, name);
    assert.equal((await transactionsFor(upload.id)).length, 0, name);
  }
});

test('processing the same upload again replaces its rows instead of doubling them', async () => {
  const { upload } = await processFixture('edge_hdfc_overlap_15sep_06oct.csv');
  const before = (await transactionsFor(upload.id)).length;

  // Simulate a retry after a crash: put it back mid-stage and run it again.
  await pool.query("UPDATE uploads SET stage = 'saving' WHERE id = $1", [upload.id]);
  await processUpload(upload.id);

  const { upload: again } = await waitForUpload(baseUrl, token, upload.id);
  assert.equal(again.stage, 'completed');
  assert.equal((await transactionsFor(upload.id)).length, before);

  const { rows } = await pool.query('SELECT attempts FROM uploads WHERE id = $1', [upload.id]);
  assert.equal(rows[0].attempts, 2);
});

test('a finished upload is never processed twice by a stray job', async () => {
  const created = await uploadFixtureCopy('icici_sep2026.csv');
  const { upload } = await waitForUpload(baseUrl, token, created.id);
  assert.equal(upload.stage, 'completed');
  const before = await pool.query('SELECT attempts, finished_at FROM uploads WHERE id = $1', [upload.id]);

  await processUpload(upload.id); // completed → returns without touching it

  const after = await pool.query('SELECT attempts, finished_at FROM uploads WHERE id = $1', [upload.id]);
  assert.deepEqual(after.rows[0], before.rows[0]);
});

test('jobs lost from Redis are recovered from Postgres by the sweep', async () => {
  // Stop the worker, upload, then wipe this test's Redis keys — as if Redis
  // restarted without persistence and lost the queue.
  await worker.close();
  const created = await uploadFixtureCopy('kotak_sep2026.csv');
  const { Redis } = await import('ioredis');
  const redis = new Redis(process.env.REDIS_URL ?? 'redis://127.0.0.1:6379');
  const keys = await redis.keys(`${testEnv.queuePrefix}:*`);
  if (keys.length > 0) await redis.del(...keys);
  await redis.quit();
  // …and it has been stuck for longer than the sweep's threshold.
  await pool.query("UPDATE uploads SET updated_at = now() - interval '5 minutes' WHERE id = $1", [created.id]);

  // A fresh worker sweeps unfinished uploads back into the queue.
  worker = await startUploadWorker();
  const { upload } = await waitForUpload(baseUrl, token, created.id);
  assert.equal(upload.stage, 'completed');
});

test('an unexpected error is retried, then the upload fails without leaking details', async () => {
  // Worker paused, so it can't process the file before we break it.
  await worker.close();
  const created = await uploadFixtureCopy('axis_sep2026.csv');
  // Break it in a way that isn't the file's fault: its file vanishes from disk.
  const { rows } = await pool.query('SELECT storage_path FROM stored_files WHERE upload_id = $1', [created.id]);
  await rm(path.join(testEnv.uploadDir, rows[0].storage_path));
  worker = await startUploadWorker();

  const { upload } = await waitForUpload(baseUrl, token, created.id);
  assert.equal(upload.stage, 'failed');
  assert.equal(upload.error.code, 'INTERNAL_ERROR');
  assert.doesNotMatch(upload.error.message, /ENOENT|storage|\//);

  const attempts = await pool.query('SELECT attempts FROM uploads WHERE id = $1', [created.id]);
  assert.equal(attempts.rows[0].attempts, 3); // JOB_ATTEMPTS default
});

// Same statement content with a unique trailing comment line, so it isn't a
// byte-for-byte duplicate of an upload made by an earlier test.
async function uploadFixtureCopy(name) {
  const content = `${await readFile(path.join(FIXTURES, name), 'utf8')}\n#${randomUUID()}\n`;
  const form = new FormData();
  form.append('file', new Blob([content]), name);
  const res = await fetch(`${baseUrl}/uploads`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}` },
    body: form,
  });
  const body = await res.json();
  assert.equal(res.status, 201, JSON.stringify(body));
  return body.upload;
}
