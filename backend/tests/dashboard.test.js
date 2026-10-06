// GET /dashboard: totals, categories, timeline and merchants must agree with
// the transaction list for the same filters. Needs the real Supabase
// database and the local Redis.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isolateTestEnv, waitForUpload } from './helpers/testEnv.js';

const testEnv = await isolateTestEnv('dashboard-test');

const { createApp } = await import('../src/app.js');
const { pool } = await import('../src/db/pool.js');
const { startUploadWorker } = await import('../src/jobs/worker.js');
const { periodStarts } = await import('../src/services/dashboard.service.js');

const TEST_DOMAIN = '@dashboard.example.test';
const FIXTURES = fileURLToPath(new URL('./fixtures/statements/', import.meta.url));

let server;
let baseUrl;
let worker;
let alice;
let bob;

before(async () => {
  server = createApp().listen(0);
  baseUrl = `http://localhost:${server.address().port}`;
  worker = await startUploadWorker();
  alice = await signUp('alice');
  bob = await signUp('bob');
  // 54 September rows + 42 rows from 15 Sep to 6 Oct, 30 of them the same → 66.
  await uploadAndWait(alice, 'hdfc_sep2026.csv');
  await uploadAndWait(alice, 'edge_hdfc_overlap_15sep_06oct.csv');
});

after(async () => {
  await worker?.close();
  await pool.query('DELETE FROM users WHERE email LIKE $1', [`%${TEST_DOMAIN}`]);
  await testEnv.cleanup();
  await pool.end();
  server.close();
});

async function signUp(name) {
  const credentials = { email: `${name}-${randomUUID()}${TEST_DOMAIN}`, password: 'correct-horse' };
  const post = (p, body) => fetch(`${baseUrl}${p}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  await post('/auth/signup', { ...credentials, name });
  return { token: (await (await post('/auth/login', credentials)).json()).accessToken };
}

async function get(user, urlPath) {
  const res = await fetch(`${baseUrl}${urlPath}`, { headers: { authorization: `Bearer ${user.token}` } });
  return { status: res.status, body: await res.json() };
}

async function uploadAndWait(user, name) {
  const form = new FormData();
  form.append('file', new Blob([await readFile(path.join(FIXTURES, name))]), name);
  const res = await fetch(`${baseUrl}/uploads`, { method: 'POST', headers: { authorization: `Bearer ${user.token}` }, body: form });
  const { upload } = await res.json();
  assert.equal((await waitForUpload(baseUrl, user.token, upload.id)).upload.stage, 'completed');
}

// Totals computed by hand from the transaction list, for cross-checking.
async function totalsFromList(user, query) {
  const { body } = await get(user, `/transactions?limit=200&${query}`);
  assert.equal(body.pagination.hasMore, false);
  const sum = (direction) => body.transactions.filter((t) => t.direction === direction).reduce((n, t) => n + t.amountPaise, 0);
  return { count: body.transactions.length, debitPaise: sum('debit'), creditPaise: sum('credit') };
}

const sumOf = (rows, key) => rows.reduce((n, row) => n + row[key], 0);

test('totals match the transaction list exactly, with and without filters', async () => {
  for (const query of ['', 'from=2026-09-10&to=2026-09-20', 'category=food_dining', 'direction=credit', 'q=swiggy']) {
    const { status, body } = await get(alice, `/dashboard?${query}`);
    assert.equal(status, 200, query);
    const expected = await totalsFromList(alice, query);
    assert.deepEqual(body.totals, { ...expected, netPaise: expected.creditPaise - expected.debitPaise }, query);
  }
  const { body } = await get(alice, '/dashboard');
  assert.equal(body.totals.count, 66); // overlap counted once
  assert.deepEqual(body.period, { from: '2026-09-01', to: '2026-10-06' });
});

test('categories add up to the totals and carry their names', async () => {
  const { body } = await get(alice, '/dashboard');
  assert.equal(sumOf(body.byCategory, 'count'), body.totals.count);
  assert.equal(sumOf(body.byCategory, 'debitPaise'), body.totals.debitPaise);
  assert.equal(sumOf(body.byCategory, 'creditPaise'), body.totals.creditPaise);
  const salary = body.byCategory.find((c) => c.category === 'salary');
  assert.deepEqual([salary.name, salary.kind], ['Salary', 'income']);
});

test('monthly timeline: one point per month, adding up to the totals', async () => {
  const { body } = await get(alice, '/dashboard?granularity=month');
  assert.deepEqual(body.timeline.map((p) => p.period), ['2026-09-01', '2026-10-01']);
  assert.equal(sumOf(body.timeline, 'debitPaise'), body.totals.debitPaise);
  for (const point of body.timeline) {
    // The stacked chart's pieces add up to the bar.
    assert.equal(Object.values(point.spendingByCategory).reduce((a, b) => a + b, 0), point.debitPaise);
  }
});

test('daily and weekly timelines have no gaps; weeks start on Monday', async () => {
  const daily = (await get(alice, '/dashboard?granularity=day')).body.timeline;
  assert.equal(daily.length, 36); // 1 Sep … 6 Oct, empty days included as zeros
  assert.ok(daily.some((p) => p.count === 0));

  const weekly = (await get(alice, '/dashboard?granularity=week')).body.timeline;
  assert.equal(weekly[0].period, '2026-08-31'); // the Monday of the week holding Tue 1 Sep
  for (const point of weekly) assert.equal(new Date(`${point.period}T00:00:00Z`).getUTCDay(), 1);
  assert.equal(sumOf(weekly, 'count'), 66);
});

test('top merchants: by money out, biggest first', async () => {
  const { body } = await get(alice, '/dashboard');
  assert.ok(body.topMerchants.length > 0 && body.topMerchants.length <= 10);
  const amounts = body.topMerchants.map((m) => m.debitPaise);
  assert.deepEqual(amounts, [...amounts].sort((a, b) => b - a));
  assert.equal(body.topMerchants[0].merchantKey, 'rameshk@okicici'); // rent
});

test('a user with no transactions gets zeros, not errors; nobody sees anyone else', async () => {
  const { status, body } = await get(bob, '/dashboard');
  assert.equal(status, 200);
  assert.deepEqual(body.totals, { count: 0, debitPaise: 0, creditPaise: 0, netPaise: 0 });
  assert.deepEqual(body.period, { from: null, to: null });
  assert.deepEqual([body.byCategory, body.timeline, body.topMerchants], [[], [], []]);
});

test('bad parameters are rejected', async () => {
  assert.equal((await get(alice, '/dashboard?granularity=year')).status, 400);
  assert.equal((await get(alice, '/dashboard?from=2026-10-01&to=2026-09-01')).status, 400);
});

test('period starts: months, Monday weeks, and a cap on how many', () => {
  assert.deepEqual(periodStarts('2026-01-31', '2026-03-01', 'month'), ['2026-01-01', '2026-02-01', '2026-03-01']);
  assert.deepEqual(periodStarts('2026-09-06', '2026-09-14', 'week'), ['2026-08-31', '2026-09-07', '2026-09-14']);
  assert.equal(periodStarts('2000-01-01', '2099-12-31', 'day').length, 1001); // stops one past the limit
});
