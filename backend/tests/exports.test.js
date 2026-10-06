// CSV and PDF exports. The CSV must contain exactly the rows the list and the
// dashboard show for the same filters. Needs the real Supabase database and
// the local Redis.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'csv-parse/sync';
import { PDFParse } from 'pdf-parse';
import { isolateTestEnv, waitForUpload } from './helpers/testEnv.js';
import { hdfcStatementCsv } from './helpers/statements.js';

const testEnv = await isolateTestEnv('exports-test');

const { createApp } = await import('../src/app.js');
const { pool } = await import('../src/db/pool.js');
const { startUploadWorker } = await import('../src/jobs/worker.js');

const TEST_DOMAIN = '@exports.example.test';
const FIXTURES = fileURLToPath(new URL('./fixtures/statements/', import.meta.url));

let server;
let baseUrl;
let worker;
let alice; // the HDFC statement + the overlapping one: 66 transactions
let bob; // nothing
let carol; // 4,500 generated transactions: several export pages

before(async () => {
  server = createApp().listen(0);
  baseUrl = `http://localhost:${server.address().port}`;
  worker = await startUploadWorker();
  [alice, bob, carol] = await Promise.all([signUp('alice'), signUp('bob'), signUp('carol')]);
  await upload(alice, await readFile(path.join(FIXTURES, 'hdfc_sep2026.csv')), 'hdfc.csv');
  await upload(alice, await readFile(path.join(FIXTURES, 'edge_hdfc_overlap_15sep_06oct.csv')), 'overlap.csv');
  // A description a spreadsheet would run as a formula.
  await upload(alice, [
    'Date,Narration,Chq./Ref.No.,Value Dt,Withdrawal Amt.,Deposit Amt.,Closing Balance',
    "07/10/2026,=HYPERLINK(\"http://evil.example\";\"click\"),REF1,07/10/2026,10.00,,100.00",
  ].join('\n'), 'formula.csv');
  await upload(carol, hdfcStatementCsv(4500, { seed: 42 }), 'big.csv');
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
  const post = (p, body) => fetch(`${baseUrl}${p}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  await post('/auth/signup', { ...credentials, name });
  return { token: (await (await post('/auth/login', credentials)).json()).accessToken };
}

async function upload(user, content, name) {
  const form = new FormData();
  form.append('file', new Blob([content]), name);
  const res = await fetch(`${baseUrl}/uploads`, { method: 'POST', headers: { authorization: `Bearer ${user.token}` }, body: form });
  const body = await res.json();
  assert.equal(res.status, 201, JSON.stringify(body));
  const done = (await waitForUpload(baseUrl, user.token, body.upload.id, { timeoutMs: 60_000 })).upload;
  assert.equal(done.stage, 'completed', JSON.stringify(done.error));
}

async function download(user, urlPath) {
  const res = await fetch(`${baseUrl}${urlPath}`, { headers: user ? { authorization: `Bearer ${user.token}` } : {} });
  return { res, bytes: Buffer.from(await res.arrayBuffer()) };
}

async function csvRows(user, query = '') {
  const { res, bytes } = await download(user, `/exports/transactions.csv?${query}`);
  assert.equal(res.status, 200);
  return parse(bytes, { bom: true, columns: true });
}

async function getJson(user, urlPath) {
  return (await fetch(`${baseUrl}${urlPath}`, { headers: { authorization: `Bearer ${user.token}` } })).json();
}

const paise = (text) => (text === '' ? 0 : Math.round(Number(text) * 100));

// ---------- CSV ----------

test('CSV: a download with the right headers, a BOM, oldest first', async () => {
  const { res, bytes } = await download(alice, '/exports/transactions.csv');
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'text/csv; charset=utf-8');
  assert.match(res.headers.get('content-disposition'), /^attachment; filename="transactions-\d{4}-\d{2}-\d{2}\.csv"$/);
  assert.equal(res.headers.get('cache-control'), 'no-store');
  assert.deepEqual([...bytes.subarray(0, 3)], [0xef, 0xbb, 0xbf]); // UTF-8 BOM for Excel

  const rows = parse(bytes, { bom: true, columns: true });
  assert.equal(rows.length, 67); // 66 + the formula row
  assert.deepEqual(Object.keys(rows[0]), ['Date', 'Description', 'Reference', 'Debit', 'Credit', 'Balance', 'Category', 'Categorized by', 'Merchant']);
  assert.equal(rows[0].Date, '01/09/2026');
  assert.equal(rows[0].Debit, '936.45');
  assert.equal(rows[0].Category, 'Bills & Utilities');
  assert.equal(rows[0]['Categorized by'], 'Rule');
});

test('CSV: same rows and the same money as the dashboard, for any filter', async () => {
  for (const query of ['', 'category=food_dining', 'from=2026-09-15&to=2026-09-30', 'direction=credit']) {
    const rows = await csvRows(alice, query);
    const { totals } = await getJson(alice, `/dashboard?${query}`);
    assert.equal(rows.length, totals.count, query);
    assert.equal(rows.reduce((n, r) => n + paise(r.Debit), 0), totals.debitPaise, query);
    assert.equal(rows.reduce((n, r) => n + paise(r.Credit), 0), totals.creditPaise, query);
  }
});

test('CSV: a description that looks like a formula stays text', async () => {
  const [row] = await csvRows(alice, 'q=HYPERLINK');
  assert.ok(row.Description.startsWith("'=HYPERLINK"), row.Description);
});

test('CSV: thousands of rows stream across pages with nothing repeated or lost', async () => {
  const rows = await csvRows(carol);
  assert.equal(rows.length, 4500);
  assert.equal(new Set(rows.map((r) => r.Reference)).size, 4500);
  const iso = rows.map((r) => r.Date.split('/').reverse().join('-'));
  assert.deepEqual(iso, [...iso].sort()); // oldest first, across page boundaries
});

test("CSV: other users' rows never appear; bad filters and no login are rejected", async () => {
  assert.deepEqual(await csvRows(bob), []);
  const bad = await download(alice, '/exports/transactions.csv?category=pets');
  assert.equal(bad.res.status, 400);
  assert.equal(JSON.parse(bad.bytes).error.code, 'VALIDATION_ERROR');
  assert.equal((await download(null, '/exports/transactions.csv')).res.status, 401);
});

// ---------- PDF ----------

async function pdfText(user, query = '') {
  const { res, bytes } = await download(user, `/exports/report.pdf?${query}`);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'application/pdf');
  assert.equal(bytes.subarray(0, 5).toString(), '%PDF-');
  const parser = new PDFParse({ data: bytes });
  try {
    return (await parser.getText()).text;
  } finally {
    await parser.destroy();
  }
}

test('PDF: the report shows the totals, categories, months and transactions', async () => {
  const text = await pdfText(alice);
  const { totals } = await getJson(alice, '/dashboard');
  for (const expected of [
    'Expense report',
    '01/09/2026 to 07/10/2026',
    `Rs ${(totals.debitPaise / 100).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`,
    'Spending by category',
    'Rent & Housing',
    'September 2026',
    'October 2026',
    'Top merchants',
    'Page 1 of',
  ]) {
    assert.ok(text.includes(expected), `missing "${expected}"`);
  }
});

test('PDF: filters are printed on it; long reports list 500 rows and say so', async () => {
  assert.ok((await pdfText(alice, 'category=food_dining')).includes('Filters: category: Food & Dining'));

  const big = await pdfText(carol);
  assert.ok(big.includes('Transactions (first 500; export CSV for all)'));
  assert.match(big, /Page \d+ of \d+/);
});

test('PDF: an empty account still gets a valid report', async () => {
  assert.ok((await pdfText(bob)).includes('No transactions match these filters'));
});
