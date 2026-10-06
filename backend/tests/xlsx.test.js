// The .xlsx upload gate: real workbooks pass; legacy, disguised, damaged and
// zip-bomb files are rejected and leave nothing behind. All zips are built in
// memory with yazl. Runs against the real Supabase database, files in a
// throwaway folder.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import yazl from 'yazl';

const uploadDir = await mkdtemp(path.join(tmpdir(), 'xlsx-test-'));
process.env.UPLOAD_DIR = uploadDir;

const { createApp } = await import('../src/app.js');
const { pool } = await import('../src/db/pool.js');

const TEST_DOMAIN = '@xlsx.example.test';
const MB = 1024 * 1024;

let server;
let baseUrl;
let token;

before(async () => {
  server = createApp().listen(0);
  baseUrl = `http://localhost:${server.address().port}`;

  const credentials = { email: `user-${randomUUID()}${TEST_DOMAIN}`, password: 'correct-horse' };
  await postJson('/auth/signup', { ...credentials, name: 'Xlsx Test' });
  token = (await (await postJson('/auth/login', credentials)).json()).accessToken;
});

after(async () => {
  await pool.query('DELETE FROM users WHERE email LIKE $1', [`%${TEST_DOMAIN}`]);
  await pool.end();
  server.close();
  await rm(uploadDir, { recursive: true, force: true });
});

// ---------- helpers ----------

function postJson(urlPath, body) {
  return fetch(`${baseUrl}${urlPath}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function upload(bytes, filename = 'statement.xlsx') {
  const form = new FormData();
  form.append('file', new Blob([bytes]), filename);
  const res = await fetch(`${baseUrl}/uploads`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}` },
    body: form,
  });
  return { status: res.status, body: await res.json() };
}

// Builds a zip in memory from { name: Buffer|string } entries.
function buildZip(entries) {
  return new Promise((resolve, reject) => {
    const zip = new yazl.ZipFile();
    for (const [name, content] of Object.entries(entries)) {
      zip.addBuffer(Buffer.from(content), name, { compress: true });
    }
    zip.end();
    const chunks = [];
    zip.outputStream.on('data', (c) => chunks.push(c)).on('end', () => resolve(Buffer.concat(chunks))).on('error', reject);
  });
}

// The minimum set of files that makes a zip an .xlsx workbook.
function minimalWorkbook(extra = {}) {
  return {
    '[Content_Types].xml': '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>',
    '_rels/.rels': '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>',
    'xl/workbook.xml': '<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"/>',
    // Unique content so each test's file has a different SHA-256.
    'xl/worksheets/sheet1.xml': `<?xml version="1.0"?><worksheet><!-- ${randomUUID()} --></worksheet>`,
    ...extra,
  };
}

// Rewrites ONE entry's declared uncompressed size, in both the local file
// header and the central directory, so the zip *claims* that entry is tiny.
// Every other entry stays honest, so only the lie can trigger a rejection.
function lieAboutUncompressedSize(zipBytes, entryName, claimedSize) {
  const out = Buffer.from(zipBytes);
  const name = Buffer.from(entryName);
  // [signature, offset of name-length field, offset of name, offset of size field]
  const headers = [
    [0x04034b50, 26, 30, 22], // local file header
    [0x02014b50, 28, 46, 24], // central directory record
  ];
  let patched = 0;
  for (let i = 0; i < out.length - 4; i++) {
    for (const [signature, nameLengthAt, nameAt, sizeAt] of headers) {
      if (out.readUInt32LE(i) !== signature) continue;
      const nameLength = out.readUInt16LE(i + nameLengthAt);
      if (out.subarray(i + nameAt, i + nameAt + nameLength).equals(name)) {
        out.writeUInt32LE(claimedSize, i + sizeAt);
        patched++;
      }
    }
  }
  assert.equal(patched, 2, 'expected to patch the local header and the central directory');
  return out;
}

const tmpFiles = () => readdir(path.join(uploadDir, 'tmp'));

// ---------- tests ----------

test('a real .xlsx workbook is accepted with format "xlsx"', async () => {
  const res = await upload(await buildZip(minimalWorkbook()));
  assert.equal(res.status, 201);
  assert.equal(res.body.upload.format, 'xlsx');
  assert.equal(res.body.upload.status, 'received');
});

test('.XLSX in capitals is the same format', async () => {
  const res = await upload(await buildZip(minimalWorkbook()), 'STATEMENT.XLSX');
  assert.equal(res.status, 201);
  assert.equal(res.body.upload.format, 'xlsx');
});

test('a legacy .xls name → 415 with a "save as .xlsx or CSV" message', async () => {
  const res = await upload(await buildZip(minimalWorkbook()), 'statement.xls');
  assert.equal(res.status, 415);
  assert.equal(res.body.error.code, 'LEGACY_OR_PROTECTED_WORKBOOK');
  assert.match(res.body.error.message, /\.xlsx or CSV/);
});

test('an old binary workbook renamed to .xlsx → 415 (OLE2 signature detected)', async () => {
  const ole2 = Buffer.concat([Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]), Buffer.alloc(512, 1)]);
  const res = await upload(ole2);
  assert.equal(res.status, 415);
  assert.equal(res.body.error.code, 'LEGACY_OR_PROTECTED_WORKBOOK');
});

test('a CSV renamed to .xlsx → 400 INVALID_XLSX', async () => {
  const res = await upload('Date,Narration\n01/09/26,UPI-SWIGGY\n');
  assert.equal(res.status, 400);
  assert.equal(res.body.error.code, 'INVALID_XLSX');
});

test('an .xlsx renamed to .csv → 400 (contains NUL bytes, not text)', async () => {
  const res = await upload(await buildZip(minimalWorkbook()), 'statement.csv');
  assert.equal(res.status, 400);
  assert.equal(res.body.error.code, 'NOT_A_TEXT_FILE');
});

test('a zip that is not a workbook (no xl/workbook.xml) → 400 INVALID_XLSX', async () => {
  const res = await upload(await buildZip({ 'word/document.xml': '<doc/>', '[Content_Types].xml': '<Types/>' }));
  assert.equal(res.status, 400);
  assert.equal(res.body.error.code, 'INVALID_XLSX');
});

test('a truncated (damaged) .xlsx → 400 INVALID_XLSX', async () => {
  const whole = await buildZip(minimalWorkbook());
  const res = await upload(whole.subarray(0, Math.floor(whole.length / 2)));
  assert.equal(res.status, 400);
  assert.equal(res.body.error.code, 'INVALID_XLSX');
});

test('zip bomb, honest sizes: expands past 50 MB → 400 XLSX_TOO_LARGE', async () => {
  // 60 MB of zeros compresses to ~60 KB.
  const bomb = await buildZip(minimalWorkbook({ 'xl/worksheets/sheet2.xml': Buffer.alloc(60 * MB) }));
  assert.ok(bomb.length < MB, 'the bomb itself should be small');

  const res = await upload(bomb);
  assert.equal(res.status, 400);
  assert.equal(res.body.error.code, 'XLSX_TOO_LARGE');
});

test('zip bomb under 50 MB but ~1000:1 compressed → 400 SUSPICIOUS_COMPRESSION', async () => {
  const bomb = await buildZip(minimalWorkbook({ 'xl/worksheets/sheet2.xml': Buffer.alloc(5 * MB) }));
  const res = await upload(bomb);
  assert.equal(res.status, 400);
  assert.equal(res.body.error.code, 'SUSPICIOUS_COMPRESSION');
});

test('zip bomb that LIES about its size → caught while decompressing', async () => {
  // Really 2 MB, but the headers claim 1,000 bytes — so the size and ratio
  // checks see nothing wrong. Only actually decompressing reveals the lie.
  const honest = await buildZip(minimalWorkbook({ 'xl/worksheets/sheet2.xml': Buffer.alloc(2 * MB) }));
  const lying = lieAboutUncompressedSize(honest, 'xl/worksheets/sheet2.xml', 1000);

  const res = await upload(lying);
  assert.equal(res.status, 400);
  assert.equal(res.body.error.code, 'INVALID_XLSX');
});

test('too many internal files → 400 XLSX_TOO_COMPLEX', async () => {
  const extra = {};
  for (let i = 0; i < 250; i++) extra[`xl/media/image${i}.xml`] = '<x/>';
  const res = await upload(await buildZip(minimalWorkbook(extra)));
  assert.equal(res.status, 400);
  assert.equal(res.body.error.code, 'XLSX_TOO_COMPLEX');
});

test('every rejected workbook left nothing behind in tmp/', async () => {
  assert.deepEqual(await tmpFiles(), []);
});
