// Runs against the real Supabase database, but stores files in a throwaway
// folder. Test users (and, by cascade, their uploads) are deleted afterwards.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { isolateTestEnv } from './helpers/testEnv.js';

// Must be set before the app is imported, because env.js reads it on import.
const testEnv = await isolateTestEnv('uploads-test');
const { uploadDir } = testEnv;

const { createApp } = await import('../src/app.js');
const { pool } = await import('../src/db/pool.js');

const TEST_DOMAIN = '@uploads.example.test';
const CSV = 'Date,Narration,Withdrawal Amt.\n01/09/26,UPI-SWIGGY,349.00\n';

let server;
let baseUrl;
let token;

before(async () => {
  server = createApp().listen(0);
  baseUrl = `http://localhost:${server.address().port}`;

  const email = `user-${randomUUID()}${TEST_DOMAIN}`;
  const credentials = { email, password: 'correct-horse' };
  await postJson('/auth/signup', { ...credentials, name: 'Upload Test' });
  token = (await (await postJson('/auth/login', credentials)).json()).accessToken;
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

function upload(content, { filename = 'statement.csv', field = 'file', auth = true } = {}) {
  const form = new FormData();
  form.append(field, new Blob([content]), filename);
  return fetch(`${baseUrl}/uploads`, {
    method: 'POST',
    headers: auth ? { authorization: `Bearer ${token}` } : {},
    body: form,
  });
}

const filesIn = (sub) => readdir(path.join(uploadDir, sub));

test('a valid CSV is stored and returns 201', async () => {
  const res = await upload(`${CSV}# ${randomUUID()}\n`);
  const body = await res.json();

  assert.equal(res.status, 201);
  assert.equal(body.upload.originalFilename, 'statement.csv');
  assert.equal(body.upload.format, 'csv');
  assert.equal(body.upload.stage, 'queued');
  assert.ok((await filesIn('files')).includes(body.upload.id));
});

test('the file path is recorded in stored_files, mapped to the user', async () => {
  const res = await upload(`${CSV}# ${randomUUID()}\n`);
  const { upload: created } = await res.json();

  const { rows } = await pool.query(
    `SELECT sf.user_id, sf.storage_path, u.email
     FROM stored_files sf JOIN users u ON u.id = sf.user_id
     WHERE sf.upload_id = $1`,
    [created.id],
  );

  assert.equal(rows.length, 1);
  assert.ok(rows[0].email.endsWith(TEST_DOMAIN));
  assert.equal(rows[0].storage_path, `files/${created.id}`);
  // The stored relative path really points at the file on disk.
  assert.ok((await filesIn('files')).includes(path.basename(rows[0].storage_path)));
});

test('a stored file cannot claim a different owner than its upload', async () => {
  const res = await upload(`${CSV}# ${randomUUID()}\n`);
  const { upload: created } = await res.json();
  // Remove the real mapping so only the ownership rule can reject the insert
  // (otherwise UNIQUE(upload_id) fires first).
  await pool.query('DELETE FROM stored_files WHERE upload_id = $1', [created.id]);

  await assert.rejects(
    pool.query(
      `INSERT INTO stored_files (upload_id, user_id, storage_path)
       VALUES ($1, gen_random_uuid(), 'files/forged')`,
      [created.id],
    ),
    { code: '23503' }, // foreign key violation
  );
});

test('the same file twice → 409 DUPLICATE_FILE with the existing id', async () => {
  const content = `${CSV}# ${randomUUID()}\n`;
  const first = await (await upload(content)).json();

  const res = await upload(content, { filename: 'renamed.csv' });
  const body = await res.json();

  assert.equal(res.status, 409);
  assert.equal(body.error.code, 'DUPLICATE_FILE');
  assert.equal(body.error.details.existingUploadId, first.upload.id);
});

test('no token → 401, and nothing is written to disk', async () => {
  const before = (await filesIn('files')).length;
  const res = await upload(CSV, { auth: false });

  assert.equal(res.status, 401);
  assert.equal((await filesIn('files')).length, before);
  assert.deepEqual(await filesIn('tmp'), []);
});

test('an empty file → 400 EMPTY_FILE', async () => {
  const res = await upload('');
  assert.equal(res.status, 400);
  assert.equal((await res.json()).error.code, 'EMPTY_FILE');
});

test('an unsupported extension → 415 UNSUPPORTED_FILE_TYPE', async () => {
  const res = await upload(CSV, { filename: 'statement.pdf' });
  assert.equal(res.status, 415);
  assert.equal((await res.json()).error.code, 'UNSUPPORTED_FILE_TYPE');
});

test('binary content renamed to .csv → 400 NOT_A_TEXT_FILE', async () => {
  const res = await upload(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x00, 0x00, 0xff]));
  assert.equal(res.status, 400);
  assert.equal((await res.json()).error.code, 'NOT_A_TEXT_FILE');
});

test('invalid UTF-8 → 400 INVALID_ENCODING', async () => {
  const res = await upload(new Uint8Array([0x44, 0x61, 0x74, 0x65, 0xc3, 0x28]));
  assert.equal(res.status, 400);
  assert.equal((await res.json()).error.code, 'INVALID_ENCODING');
});

test('wrong field name → 400 UNEXPECTED_FIELD', async () => {
  const res = await upload(CSV, { field: 'document' });
  assert.equal(res.status, 400);
  assert.equal((await res.json()).error.code, 'UNEXPECTED_FIELD');
});

test('not multipart at all → 415 UNSUPPORTED_MEDIA_TYPE', async () => {
  const res = await fetch(`${baseUrl}/uploads`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'text/csv' },
    body: CSV,
  });
  assert.equal(res.status, 415);
});

test('a path in the filename is stripped to the bare name', async () => {
  const res = await upload(`${CSV}# ${randomUUID()}\n`, { filename: '../../etc/evil.csv' });
  const body = await res.json();
  assert.equal(res.status, 201);
  assert.equal(body.upload.originalFilename, 'evil.csv');
});

test('rejected uploads leave nothing behind in tmp/', async () => {
  assert.deepEqual(await filesIn('tmp'), []);
});
