// Edge cases for the upload gate: network drops, size limits, multiple files,
// and the sample statements in tests/fixtures/statements (synthetic data).
// Runs against the real Supabase database, with files in a throwaway folder
// and a small 64 KB limit so oversized uploads are quick to send.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const MAX_BYTES = 64 * 1024;
const uploadDir = await mkdtemp(path.join(tmpdir(), 'uploads-edge-test-'));
process.env.UPLOAD_DIR = uploadDir;
process.env.UPLOAD_MAX_BYTES = String(MAX_BYTES);

const { createApp } = await import('../src/app.js');
const { pool } = await import('../src/db/pool.js');

const TEST_DOMAIN = '@uploadsedge.example.test';
const FIXTURES = new URL('./fixtures/statements/', import.meta.url);
const BOUNDARY = 'TestBoundary7MA4YWxk';

let server;
let port;
let token;
let userId;

before(async () => {
  server = createApp().listen(0);
  port = server.address().port;

  const credentials = { email: `user-${randomUUID()}${TEST_DOMAIN}`, password: 'correct-horse' };
  await postJson('/auth/signup', { ...credentials, name: 'Edge Test' });
  const login = await (await postJson('/auth/login', credentials)).json();
  token = login.accessToken;
  userId = login.user.id;
});

after(async () => {
  await pool.query('DELETE FROM users WHERE email LIKE $1', [`%${TEST_DOMAIN}`]);
  await pool.end();
  server.close();
  await rm(uploadDir, { recursive: true, force: true });
});

// ---------- helpers ----------

function postJson(urlPath, body) {
  return fetch(`http://localhost:${port}${urlPath}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function uploadFixture(name) {
  const form = new FormData();
  form.append('file', new Blob([await readFile(new URL(name, FIXTURES))]), name);
  const res = await fetch(`http://localhost:${port}/uploads`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}` },
    body: form,
  });
  return { status: res.status, body: await res.json() };
}

// fetch() can't send a deliberately broken or half-finished request, so these
// tests build the HTTP request by hand with node:http.
function rawUploadRequest(headers) {
  return http.request({
    port,
    method: 'POST',
    path: '/uploads',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': `multipart/form-data; boundary=${BOUNDARY}`,
      ...headers,
    },
  });
}

const partHeader = (filename = 'statement.csv', field = 'file') =>
  `--${BOUNDARY}\r\nContent-Disposition: form-data; name="${field}"; filename="${filename}"\r\n` +
  'Content-Type: text/csv\r\n\r\n';
const closing = `\r\n--${BOUNDARY}--\r\n`;

function readResponse(req) {
  return new Promise((resolve, reject) => {
    req.on('response', (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: JSON.parse(data) }));
    });
    req.on('error', reject);
  });
}

const tmpFiles = () => readdir(path.join(uploadDir, 'tmp'));
const storedFiles = () => readdir(path.join(uploadDir, 'files'));

async function uploadRowCount() {
  const { rows } = await pool.query('SELECT count(*)::int AS n FROM uploads WHERE user_id = $1', [userId]);
  return rows[0].n;
}

async function waitFor(check, what, timeoutMs = 3000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((r) => setTimeout(r, 25));
  }
  assert.fail(`Timed out waiting for: ${what}`);
}

// ---------- network drops and limits ----------

test('connection dropped mid-upload: partial file deleted, no row created', async () => {
  const rowsBefore = await uploadRowCount();
  const filesBefore = (await storedFiles()).length;

  // Promise a 60 KB body (under the limit) but only send half of it.
  const req = rawUploadRequest({ 'content-length': 60_000 });
  req.on('error', () => {}); // destroying the socket below is intentional
  req.write(partHeader() + 'x'.repeat(30_000));

  // Prove the server really started writing a temp file...
  await waitFor(async () => (await tmpFiles()).length === 1, 'temp file to appear');

  // ...then pull the plug, like a dropped Wi-Fi connection.
  req.destroy();

  await waitFor(async () => (await tmpFiles()).length === 0, 'temp file to be deleted');
  assert.equal(await uploadRowCount(), rowsBefore);
  assert.equal((await storedFiles()).length, filesBefore);
});

test('declared size over the limit: 413 before the body is read', async () => {
  const req = rawUploadRequest({ 'content-length': 50_000_000 });
  const response = readResponse(req);
  req.flushHeaders(); // send headers only — no body at all

  const res = await response;
  assert.equal(res.status, 413);
  assert.equal(res.body.error.code, 'FILE_TOO_LARGE');
  assert.equal(res.headers.connection, 'close');
  assert.deepEqual(await tmpFiles(), []);
});

test('no declared size, real size over the limit: caught while streaming', async () => {
  const rowsBefore = await uploadRowCount();

  const req = rawUploadRequest({ 'transfer-encoding': 'chunked' });
  const response = readResponse(req);
  req.write(partHeader());
  req.write('a,b\n'.repeat(MAX_BYTES / 2)); // 2× the limit
  req.end(closing);

  const res = await response;
  assert.equal(res.status, 413);
  assert.equal(res.body.error.code, 'FILE_TOO_LARGE');
  await waitFor(async () => (await tmpFiles()).length === 0, 'temp file to be deleted');
  assert.equal(await uploadRowCount(), rowsBefore);
});

test('exactly at the limit is accepted, one byte over is not', async () => {
  const content = `a,b\n${randomUUID()}\n`;
  const body = content + 'x'.repeat(MAX_BYTES - Buffer.byteLength(content));

  const req = rawUploadRequest({ 'transfer-encoding': 'chunked' });
  const response = readResponse(req);
  req.end(partHeader() + body + closing);

  const res = await response;
  assert.equal(res.status, 201);
  assert.equal(res.body.upload.sizeBytes, MAX_BYTES);

  const overReq = rawUploadRequest({ 'transfer-encoding': 'chunked' });
  const overResponse = readResponse(overReq);
  overReq.end(partHeader() + body + 'x' + closing);

  const over = await overResponse;
  assert.equal(over.status, 413);
  assert.equal(over.body.error.code, 'FILE_TOO_LARGE');
});

test('two files in one request → 400 TOO_MANY_FILES, nothing stored', async () => {
  const rowsBefore = await uploadRowCount();

  const req = rawUploadRequest({ 'transfer-encoding': 'chunked' });
  const response = readResponse(req);
  req.end(
    partHeader('one.csv') + 'a,b\n1,2' + '\r\n' +
    partHeader('two.csv') + 'c,d\n3,4' + closing,
  );

  const res = await response;
  assert.equal(res.status, 400);
  assert.equal(res.body.error.code, 'TOO_MANY_FILES');
  await waitFor(async () => (await tmpFiles()).length === 0, 'temp file to be deleted');
  assert.equal(await uploadRowCount(), rowsBefore);
});

test('a broken multipart body → 400 MALFORMED_UPLOAD', async () => {
  const req = rawUploadRequest({ 'transfer-encoding': 'chunked' });
  const response = readResponse(req);
  // Starts a file part but the body ends without the closing boundary.
  req.end(partHeader() + 'a,b\n1,2');

  const res = await response;
  assert.equal(res.status, 400);
  assert.equal(res.body.error.code, 'MALFORMED_UPLOAD');
  await waitFor(async () => (await tmpFiles()).length === 0, 'temp file to be deleted');
});

// ---------- the sample statements ----------

test('all five bank statements pass the upload gate', async () => {
  for (const name of ['hdfc_sep2026.csv', 'sbi_sep2026.csv', 'icici_sep2026.csv', 'axis_sep2026.csv', 'kotak_sep2026.csv']) {
    const res = await uploadFixture(name);
    assert.equal(res.status, 201, name);
    assert.equal(res.body.upload.status, 'received', name);
  }
});

test('the same statement uploaded again → 409 with the original id', async () => {
  const { rows } = await pool.query(
    "SELECT id FROM uploads WHERE user_id = $1 AND original_filename = 'hdfc_sep2026.csv'",
    [userId],
  );
  const res = await uploadFixture('hdfc_sep2026.csv');
  assert.equal(res.status, 409);
  assert.equal(res.body.error.details.existingUploadId, rows[0].id);
});

test('an overlapping statement has different bytes, so the upload gate accepts it', async () => {
  // Row-level dedupe of the overlapping 15–30 Sep rows is parsing's job (T37).
  const res = await uploadFixture('edge_hdfc_overlap_15sep_06oct.csv');
  assert.equal(res.status, 201);
});

test('edge_empty.csv → 400 EMPTY_FILE', async () => {
  const res = await uploadFixture('edge_empty.csv');
  assert.equal(res.status, 400);
  assert.equal(res.body.error.code, 'EMPTY_FILE');
});

test('safe text that may not be a statement passes the upload gate (parsing decides)', async () => {
  // These are valid UTF-8 text with no NUL bytes, so the upload gate has no
  // grounds to reject them. Whether they're bank statements is the parsing
  // gate's job (D14).
  for (const name of [
    'edge_corrupt_binary.csv',
    'edge_header_only.csv',
    'edge_malformed_rows.csv',
    'edge_unrecognized_format.csv',
  ]) {
    const res = await uploadFixture(name);
    assert.equal(res.status, 201, name);
  }
});

test('after everything above, tmp/ is empty and every row has its file on disk', async () => {
  assert.deepEqual(await tmpFiles(), []);

  const { rows } = await pool.query(
    'SELECT storage_path FROM stored_files WHERE user_id = $1',
    [userId],
  );
  const onDisk = new Set(await storedFiles());
  assert.ok(rows.length > 0);
  for (const { storage_path: storagePath } of rows) {
    assert.ok(onDisk.has(path.basename(storagePath)), `missing on disk: ${storagePath}`);
  }
  assert.equal(onDisk.size, rows.length);
});
