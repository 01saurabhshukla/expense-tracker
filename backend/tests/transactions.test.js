// GET /transactions, PATCH /transactions/:id (corrections), /categories.
// Data comes from real uploads processed by the worker. Needs the real
// Supabase database and the local Redis.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isolateTestEnv, waitForUpload } from './helpers/testEnv.js';

const testEnv = await isolateTestEnv('transactions-test');

const { createApp } = await import('../src/app.js');
const { pool } = await import('../src/db/pool.js');
const { startUploadWorker } = await import('../src/jobs/worker.js');

const TEST_DOMAIN = '@transactions.example.test';
const FIXTURES = fileURLToPath(new URL('./fixtures/statements/', import.meta.url));

let server;
let baseUrl;
let worker;
let alice; // { token, hdfcUploadId }
let bob;

before(async () => {
  server = createApp().listen(0);
  baseUrl = `http://localhost:${server.address().port}`;
  worker = await startUploadWorker();
  alice = await signUp('alice');
  bob = await signUp('bob');
  alice.hdfcUploadId = await uploadAndWait(alice, 'hdfc_sep2026.csv');
});

after(async () => {
  await worker?.close();
  await pool.query('DELETE FROM users WHERE email LIKE $1', [`%${TEST_DOMAIN}`]);
  await testEnv.cleanup();
  await pool.end();
  server.close();
});

// ---------- helpers ----------

async function signUp(name) {
  const credentials = { email: `${name}-${randomUUID()}${TEST_DOMAIN}`, password: 'correct-horse' };
  await request('POST', '/auth/signup', { body: { ...credentials, name } });
  const { body } = await request('POST', '/auth/login', { body: credentials });
  return { token: body.accessToken };
}

async function request(method, urlPath, { user, body } = {}) {
  const headers = {};
  if (user) headers.authorization = `Bearer ${user.token}`;
  if (body) headers['content-type'] = 'application/json';
  const res = await fetch(`${baseUrl}${urlPath}`, { method, headers, body: body && JSON.stringify(body) });
  return { status: res.status, body: res.status === 204 ? null : await res.json() };
}

const get = (user, urlPath) => request('GET', urlPath, { user });

async function uploadAndWait(user, name) {
  const form = new FormData();
  form.append('file', new Blob([await readFile(path.join(FIXTURES, name))]), name);
  const res = await fetch(`${baseUrl}/uploads`, { method: 'POST', headers: { authorization: `Bearer ${user.token}` }, body: form });
  const { upload } = await res.json();
  const done = (await waitForUpload(baseUrl, user.token, upload.id)).upload;
  assert.equal(done.stage, 'completed');
  return done.id;
}

// ---------- listing ----------

test('lists my transactions newest first, paginated, amounts as numbers', async () => {
  const page1 = await get(alice, '/transactions?limit=50');
  assert.equal(page1.status, 200);
  assert.equal(page1.body.transactions.length, 50);
  assert.deepEqual(page1.body.pagination, { limit: 50, offset: 0, hasMore: true });

  const [first] = page1.body.transactions;
  assert.equal(first.date, '2026-09-30');
  assert.equal(typeof first.amountPaise, 'number');
  assert.equal(first.fingerprint, undefined); // internal

  const page2 = await get(alice, '/transactions?limit=50&offset=50');
  assert.equal(page2.body.transactions.length, 4);
  assert.equal(page2.body.pagination.hasMore, false);
  const ids = new Set([...page1.body.transactions, ...page2.body.transactions].map((t) => t.id));
  assert.equal(ids.size, 54); // no row repeated or skipped across pages
});

test('filters: category, direction, dates, text search, upload', async () => {
  const food = await get(alice, '/transactions?category=food_dining&limit=200');
  assert.ok(food.body.transactions.length > 0);
  assert.ok(food.body.transactions.every((t) => t.category === 'food_dining'));

  const credits = await get(alice, '/transactions?direction=credit&limit=200');
  assert.ok(credits.body.transactions.every((t) => t.direction === 'credit'));

  const week = await get(alice, '/transactions?from=2026-09-07&to=2026-09-13&sort=date_asc&limit=200');
  const dates = week.body.transactions.map((t) => t.date);
  assert.equal(dates[0] >= '2026-09-07' && dates.at(-1) <= '2026-09-13', true);
  assert.deepEqual(dates, [...dates].sort());

  const swiggy = await get(alice, '/transactions?q=swiggy'); // case-insensitive
  assert.equal(swiggy.body.transactions.length, 3);

  const literalPercent = await get(alice, '/transactions?q=%25'); // "%" is text, not a wildcard
  assert.equal(literalPercent.body.transactions.length, 0);

  const byUpload = await get(alice, `/transactions?uploadId=${alice.hdfcUploadId}&limit=200`);
  assert.equal(byUpload.body.transactions.length, 54);
});

test('sorting by amount', async () => {
  const { body } = await get(alice, '/transactions?sort=amount_desc&limit=5');
  const amounts = body.transactions.map((t) => t.amountPaise);
  assert.deepEqual(amounts, [...amounts].sort((a, b) => b - a));
});

test('bad queries are rejected with the field named', async () => {
  for (const [query, field] of [
    ['from=2026-09-30&to=2026-09-01', 'from'],
    ['category=not_a_category', 'category'],
    ['categroy=food_dining', ''], // misspelt parameter
    ['limit=1000', 'limit'],
    ['from=30-09-2026', 'from'],
  ]) {
    const res = await get(alice, `/transactions?${query}`);
    assert.equal(res.status, 400, query);
    assert.equal(res.body.error.code, 'VALIDATION_ERROR', query);
    assert.ok(res.body.error.details.some((d) => d.field === field), `${query}: ${JSON.stringify(res.body.error.details)}`);
  }
});

test("other users' transactions are invisible and can't be changed", async () => {
  const { body } = await get(bob, '/transactions');
  assert.deepEqual(body.transactions, []);

  const [aliceRow] = (await get(alice, '/transactions?limit=1')).body.transactions;
  const res = await request('PATCH', `/transactions/${aliceRow.id}`, { user: bob, body: { category: 'travel' } });
  assert.equal(res.status, 404);
  assert.equal(res.body.error.code, 'TRANSACTION_NOT_FOUND');

  assert.equal((await request('PATCH', '/transactions/not-a-uuid', { user: alice, body: { category: 'travel' } })).status, 404);
  assert.equal((await get(alice, '/transactions')).status, 200);
  assert.equal((await request('GET', '/transactions')).status, 401);
});

// ---------- corrections ----------

test('a correction applies to every transaction from that merchant, now and in future uploads', async () => {
  const chai = (await get(alice, '/transactions?q=chai%20point')).body.transactions;
  assert.equal(chai.length, 5);
  assert.ok(chai.every((t) => t.category === 'food_dining'));

  const res = await request('PATCH', `/transactions/${chai[0].id}`, { user: alice, body: { category: 'groceries' } });
  assert.equal(res.status, 200);
  assert.equal(res.body.updatedCount, 5);
  assert.equal(res.body.rule.merchantKey, 'chaipoint@ybl');
  assert.equal(res.body.rule.category, 'groceries');
  assert.equal(res.body.transaction.category, 'groceries');
  assert.equal(res.body.transaction.categorySource, 'user');

  const after = (await get(alice, '/transactions?q=chai%20point')).body.transactions;
  assert.ok(after.every((t) => t.category === 'groceries' && t.categorySource === 'user'));

  // A different bank's statement with the same UPI handle uses the rule.
  const iciciId = await uploadAndWait(alice, 'icici_sep2026.csv');
  const icici = (await get(alice, `/transactions?uploadId=${iciciId}&q=chai%20point`)).body.transactions;
  assert.ok(icici.length > 0);
  assert.ok(icici.every((t) => t.category === 'groceries' && t.categorySource === 'user'));

  const rules = (await get(alice, '/categories/rules')).body.rules;
  assert.deepEqual(rules.map((r) => [r.merchantKey, r.category]), [['chaipoint@ybl', 'groceries']]);
});

test('applyToMerchant: false changes only that one transaction', async () => {
  const swiggy = (await get(alice, `/transactions?uploadId=${alice.hdfcUploadId}&q=swiggy`)).body.transactions;
  const res = await request('PATCH', `/transactions/${swiggy[0].id}`, {
    user: alice,
    body: { category: 'travel', applyToMerchant: false },
  });
  assert.equal(res.status, 200);
  assert.equal(res.body.updatedCount, 1);
  assert.equal(res.body.rule, null);

  const after = (await get(alice, `/transactions?uploadId=${alice.hdfcUploadId}&q=swiggy`)).body.transactions;
  assert.deepEqual(after.map((t) => t.category).sort(), ['food_dining', 'food_dining', 'travel']);
});

test('a correction must name a real category', async () => {
  const [row] = (await get(alice, '/transactions?limit=1')).body.transactions;
  const res = await request('PATCH', `/transactions/${row.id}`, { user: alice, body: { category: 'pets' } });
  assert.equal(res.status, 400);
  assert.equal(res.body.error.details[0].field, 'category');
});

// ---------- categories and rules ----------

test('GET /categories lists the fixed categories', async () => {
  const { status, body } = await get(alice, '/categories');
  assert.equal(status, 200);
  assert.equal(body.categories.length, 17);
  assert.deepEqual(body.categories[0], { key: 'food_dining', name: 'Food & Dining', kind: 'expense' });
});

test('deleting a rule keeps the transactions as they are; only the owner can delete it', async () => {
  const [rule] = (await get(alice, '/categories/rules')).body.rules;

  assert.equal((await request('DELETE', `/categories/rules/${rule.id}`, { user: bob })).status, 404);
  assert.equal((await request('DELETE', `/categories/rules/${rule.id}`, { user: alice })).status, 204);
  assert.equal((await request('DELETE', `/categories/rules/${rule.id}`, { user: alice })).status, 404);
  assert.deepEqual((await get(alice, '/categories/rules')).body.rules, []);

  const chai = (await get(alice, '/transactions?q=chai%20point&limit=200')).body.transactions;
  assert.ok(chai.every((t) => t.category === 'groceries'));
});
