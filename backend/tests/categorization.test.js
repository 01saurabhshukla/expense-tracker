// Categorization inside the real pipeline, and the categories table.
// Needs the real Supabase database and the local Redis.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isolateTestEnv, waitForUpload } from './helpers/testEnv.js';

const testEnv = await isolateTestEnv('categorization-test');

const { createApp } = await import('../src/app.js');
const { pool } = await import('../src/db/pool.js');
const { startUploadWorker } = await import('../src/jobs/worker.js');
const { CATEGORIES } = await import('../src/categorize/categories.js');

const TEST_DOMAIN = '@categorization.example.test';
const FIXTURES = fileURLToPath(new URL('./fixtures/statements/', import.meta.url));

let server;
let baseUrl;
let worker;
let token;
let userId;

before(async () => {
  server = createApp().listen(0);
  baseUrl = `http://localhost:${server.address().port}`;
  const credentials = { email: `user-${randomUUID()}${TEST_DOMAIN}`, password: 'correct-horse' };
  await fetch(`${baseUrl}/auth/signup`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ...credentials, name: 'Categorization Test' }),
  });
  const login = await (
    await fetch(`${baseUrl}/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(credentials),
    })
  ).json();
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

async function uploadAndWait(name) {
  const form = new FormData();
  form.append('file', new Blob([await readFile(path.join(FIXTURES, name))]), name);
  const res = await fetch(`${baseUrl}/uploads`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}` },
    body: form,
  });
  const { upload } = await res.json();
  return (await waitForUpload(baseUrl, token, upload.id)).upload;
}

test('the categories table matches the list in code', async () => {
  const { rows } = await pool.query('SELECT key, name, kind FROM categories ORDER BY sort_order');
  assert.deepEqual(rows, CATEGORIES);
});

test("a user's correction is applied during processing; rules handle the rest", async () => {
  // Alice decided Chai Point is "Groceries" for her (odd, but her choice).
  await pool.query(
    "INSERT INTO category_overrides (user_id, merchant_key, category) VALUES ($1, 'chaipoint@ybl', 'groceries')",
    [userId],
  );

  const upload = await uploadAndWait('hdfc_sep2026.csv');
  assert.equal(upload.stage, 'completed');
  assert.deepEqual(upload.progress.categorizedBy, { user: 5, rule: 49, none: 0 });

  const { rows } = await pool.query(
    `SELECT merchant_key, category, category_source, count(*)::int AS n
     FROM transactions WHERE upload_id = $1
     GROUP BY 1, 2, 3 ORDER BY 1`,
    [upload.id],
  );
  const chai = rows.find((r) => r.merchant_key === 'chaipoint@ybl');
  assert.deepEqual(chai, { merchant_key: 'chaipoint@ybl', category: 'groceries', category_source: 'user', n: 5 });

  const swiggy = rows.find((r) => r.merchant_key === 'swiggy@icici');
  assert.equal(swiggy.category, 'food_dining');
  assert.equal(swiggy.category_source, 'rule');
});

test('an unknown category key cannot be stored (foreign key)', async () => {
  await assert.rejects(
    pool.query(
      "INSERT INTO category_overrides (user_id, merchant_key, category) VALUES ($1, 'x@ybl', 'not_a_category')",
      [userId],
    ),
    { code: '23503' },
  );
});
