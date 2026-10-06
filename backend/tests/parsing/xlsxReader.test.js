// The .xlsx reader. Real workbooks (made by LibreOffice from the CSV
// samples) must give exactly what their CSV gives; hand-built workbooks cover
// the XML details and the ways a workbook can be broken. No database.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import yazl from 'yazl';
import { readXlsxRows } from '../../src/parsing/readers/xlsxReader.js';
import { readCsvRows } from '../../src/parsing/readers/csvReader.js';
import { findHeader } from '../../src/parsing/columns.js';
import { normalizeRows } from '../../src/parsing/normalize.js';
import { addFingerprints } from '../../src/parsing/fingerprint.js';
import { ParseError } from '../../src/parsing/errors.js';

const FIXTURES = fileURLToPath(new URL('../fixtures/statements/', import.meta.url));
const workDir = await mkdtemp(path.join(tmpdir(), 'xlsx-reader-test-'));
after(() => rm(workDir, { recursive: true, force: true }));

// ---------- helpers ----------

async function collect(rows) {
  const all = [];
  for await (const row of rows) all.push(row);
  return all;
}

async function transactionsFrom(rows) {
  const all = await collect(rows);
  const header = findHeader(all);
  const { transactions } = await normalizeRows(all.slice(header.index + 1), header);
  return addFingerprints(transactions);
}

const NS = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
const WORKSHEET_TYPE = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet';

// Builds a workbook file from parts; anything not given gets a sensible
// default. `sheetData` is the inside of <sheetData>.
async function workbook({ sheetData = '', sharedStrings, styles, workbookXml, rels, sheets, extra = {} } = {}) {
  const entries = {
    '[Content_Types].xml': '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>',
    'xl/workbook.xml':
      workbookXml ?? `<?xml version="1.0"?><workbook ${NS}><sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    'xl/_rels/workbook.xml.rels':
      rels ??
      `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${WORKSHEET_TYPE}" Target="worksheets/sheet1.xml"/></Relationships>`,
    ...(sheets ?? { 'xl/worksheets/sheet1.xml': `<?xml version="1.0"?><worksheet ${NS}><sheetData>${sheetData}</sheetData></worksheet>` }),
    ...extra,
  };
  if (sharedStrings !== undefined) {
    entries['xl/sharedStrings.xml'] = `<?xml version="1.0"?><sst ${NS}>${sharedStrings}</sst>`;
  }
  if (styles !== undefined) entries['xl/styles.xml'] = `<?xml version="1.0"?><styleSheet ${NS}>${styles}</styleSheet>`;

  const zip = new yazl.ZipFile();
  for (const [name, content] of Object.entries(entries)) zip.addBuffer(Buffer.from(content), name);
  zip.end();
  const chunks = [];
  for await (const chunk of zip.outputStream) chunks.push(chunk);

  const file = path.join(workDir, `${Math.random().toString(36).slice(2)}.xlsx`);
  await writeFile(file, Buffer.concat(chunks));
  return file;
}

const readRows = async (file) => collect(readXlsxRows(file));

async function rejectsWith(file, code, messagePart) {
  await assert.rejects(readRows(file), (err) => {
    assert.ok(err instanceof ParseError, `expected a ParseError, got ${err}`);
    assert.equal(err.code, code);
    if (messagePart) assert.match(err.message, messagePart);
    return true;
  });
}

// ---------- real workbooks ----------

test('every bank workbook gives the same transactions and fingerprints as its CSV', async () => {
  for (const bank of ['hdfc', 'sbi', 'icici', 'axis', 'kotak']) {
    const fromCsv = await transactionsFrom(readCsvRows(path.join(FIXTURES, `${bank}_sep2026.csv`)));
    const fromXlsx = await transactionsFrom(readXlsxRows(path.join(FIXTURES, `xlsx/${bank}_sep2026.xlsx`)));

    assert.equal(fromXlsx.length, fromCsv.length, bank);
    // Fingerprints equal → uploading the CSV and the .xlsx of one statement
    // stores every transaction once.
    assert.deepEqual(fromXlsx.map((t) => t.fingerprint), fromCsv.map((t) => t.fingerprint), bank);
    // Everything else equal too, except the reference: Excel turned the
    // all-digit ones into numbers and dropped their leading zeros.
    const withoutReference = ({ reference, fingerprint, ...rest }) => rest;
    assert.deepEqual(fromXlsx.map(withoutReference), fromCsv.map(withoutReference), bank);
  }
});

test('date cells are date serials in the file and come out day-first', async () => {
  const rows = await readRows(path.join(FIXTURES, 'xlsx/hdfc_sep2026.xlsx'));
  assert.deepEqual(rows.find((r) => r.line === 7).cells, [
    '01/09/2026', 'ACH D- AIRTEL BROADBAND-00626611', '6266119255', '01/09/2026', '936.45', '', '47313.55',
  ]);
});

// ---------- cell types ----------

test('shared strings (including rich text), inline strings, numbers, booleans', async () => {
  const file = await workbook({
    sharedStrings:
      '<si><t>Plain</t></si>' +
      '<si><r><t>Rich </t></r><r><t>text</t></r><rPh><t>PHONETIC</t></rPh></si>',
    sheetData:
      '<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c>' +
      '<c r="C1" t="inlineStr"><is><t>Inline</t></is></c><c r="D1"><v>654.75000000000011</v></c>' +
      '<c r="E1" t="b"><v>1</v></c><c r="F1" t="str"><v>formula text</v></c><c r="G1" t="e"><v>#N/A</v></c></row>',
  });
  assert.deepEqual(await readRows(file), [
    { line: 1, cells: ['Plain', 'Rich text', 'Inline', '654.75', 'TRUE', 'formula text', '#N/A'] },
  ]);
});

test('gaps between cells become empty strings; empty rows are skipped; line = Excel row number', async () => {
  const file = await workbook({
    sheetData:
      '<row r="2"><c r="A2" t="inlineStr"><is><t>a</t></is></c><c r="D2"><v>4</v></c></row>' +
      '<row r="3"><c r="A3" s="1"/></row>' + // styled but empty
      '<row r="7"><c r="B7"><v>2</v></c></row>',
  });
  assert.deepEqual(await readRows(file), [
    { line: 2, cells: ['a', '', '', '4'] },
    { line: 7, cells: ['', '2'] },
  ]);
});

test('a number is a date only when its style says so (built-in and custom formats)', async () => {
  const file = await workbook({
    styles:
      '<numFmts count="2"><numFmt numFmtId="164" formatCode="dd\\-mmm\\-yyyy"/><numFmt numFmtId="165" formatCode="#,##0.00"/></numFmts>' +
      '<cellStyleXfs count="1"><xf numFmtId="14"/></cellStyleXfs>' + // must NOT shift the numbering
      '<cellXfs count="4"><xf numFmtId="0"/><xf numFmtId="14"/><xf numFmtId="164"/><xf numFmtId="165"/></cellXfs>',
    sheetData:
      '<row r="1"><c r="A1" s="0"><v>46266</v></c><c r="B1" s="1"><v>46266</v></c>' +
      '<c r="C1" s="2"><v>46266.75</v></c><c r="D1" s="3"><v>46266</v></c></row>',
  });
  // 46266 = 1 Sep 2026. The time part (.75) is dropped.
  assert.deepEqual((await readRows(file))[0].cells, ['46266', '01/09/2026', '01/09/2026', '46266']);
});

test('the 1904 date system (old Mac Excel) is honoured', async () => {
  const file = await workbook({
    workbookXml: `<workbook ${NS}><workbookPr date1904="1"/><sheets><sheet name="S" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    styles: '<cellXfs count="2"><xf numFmtId="0"/><xf numFmtId="14"/></cellXfs>',
    sheetData: '<row r="1"><c r="A1" s="1"><v>44804</v></c></row>', // 1 Sep 2026 counted from 1904
  });
  assert.deepEqual((await readRows(file))[0].cells, ['01/09/2026']);
});

test('namespace prefixes (x:row, x:c) are understood', async () => {
  const file = await workbook({
    sheets: {
      'xl/worksheets/sheet1.xml':
        '<x:worksheet xmlns:x="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><x:sheetData>' +
        '<x:row r="1"><x:c r="A1" t="inlineStr"><x:is><x:t>hi</x:t></x:is></x:c></x:row></x:sheetData></x:worksheet>',
    },
  });
  assert.deepEqual(await readRows(file), [{ line: 1, cells: ['hi'] }]);
});

test('the first VISIBLE worksheet is read; hidden sheets are skipped', async () => {
  const file = await workbook({
    workbookXml:
      `<workbook ${NS}><sheets><sheet name="Hidden" sheetId="1" state="hidden" r:id="rId1"/>` +
      '<sheet name="Statement" sheetId="2" r:id="rId2"/></sheets></workbook>',
    rels:
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      `<Relationship Id="rId1" Type="${WORKSHEET_TYPE}" Target="worksheets/sheet1.xml"/>` +
      `<Relationship Id="rId2" Type="${WORKSHEET_TYPE}" Target="/xl/worksheets/sheet2.xml"/></Relationships>`,
    sheets: {
      'xl/worksheets/sheet1.xml': `<worksheet ${NS}><sheetData><row r="1"><c r="A1"><v>1</v></c></row></sheetData></worksheet>`,
      'xl/worksheets/sheet2.xml': `<worksheet ${NS}><sheetData><row r="1"><c r="A1"><v>2</v></c></row></sheetData></worksheet>`,
    },
  });
  assert.deepEqual(await readRows(file), [{ line: 1, cells: ['2'] }]);
});

// ---------- broken or hostile workbooks ----------

test('a DOCTYPE is refused (no entity tricks)', async () => {
  const file = await workbook({
    sheets: {
      'xl/worksheets/sheet1.xml':
        '<?xml version="1.0"?><!DOCTYPE x [<!ENTITY a "aaaaaaaaaa"><!ENTITY b "&a;&a;&a;&a;&a;">]>' +
        `<worksheet ${NS}><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>&b;</t></is></c></row></sheetData></worksheet>`,
    },
  });
  await rejectsWith(file, 'MALFORMED_XLSX', /DOCTYPE/);
});

test('broken XML is refused', async () => {
  await rejectsWith(await workbook({ sheetData: '<row r="1"><c r="A1"><v>1</v></row>' }), 'MALFORMED_XLSX', /invalid XML/);
});

test('text that is not UTF-8 is refused', async () => {
  const file = await workbook({
    sheets: {
      'xl/worksheets/sheet1.xml': Buffer.concat([
        Buffer.from(`<worksheet ${NS}><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>`),
        Buffer.from([0xff, 0xfe]),
        Buffer.from('</t></is></c></row></sheetData></worksheet>'),
      ]),
    },
  });
  await rejectsWith(file, 'MALFORMED_XLSX', /UTF-8/);
});

test('a cell pointing to a missing shared string is refused', async () => {
  const file = await workbook({ sharedStrings: '<si><t>only one</t></si>', sheetData: '<row r="1"><c r="A1" t="s"><v>5</v></c></row>' });
  await rejectsWith(file, 'MALFORMED_XLSX', /shared string/);
});

test('rows out of order are refused (line numbers would lie)', async () => {
  const file = await workbook({ sheetData: '<row r="5"><c r="A5"><v>1</v></c></row><row r="3"><c r="A3"><v>1</v></c></row>' });
  await rejectsWith(file, 'MALFORMED_XLSX', /out of order/);
});

test('a value far to the right is refused', async () => {
  await rejectsWith(await workbook({ sheetData: '<row r="1"><c r="ZZ1"><v>1</v></c></row>' }), 'MALFORMED_XLSX', /column/);
});

test('a sheet pointing outside the workbook is refused', async () => {
  const file = await workbook({
    rels:
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      `<Relationship Id="rId1" Type="${WORKSHEET_TYPE}" Target="../../etc/passwd"/></Relationships>`,
  });
  await rejectsWith(file, 'MALFORMED_XLSX', /outside/);
});

test('a workbook with only hidden sheets has no worksheet to read', async () => {
  const file = await workbook({
    workbookXml: `<workbook ${NS}><sheets><sheet name="S" sheetId="1" state="veryHidden" r:id="rId1"/></sheets></workbook>`,
  });
  await rejectsWith(file, 'NO_WORKSHEET');
});

test('a missing sheet file is refused', async () => {
  await rejectsWith(await workbook({ sheets: {} }), 'MALFORMED_XLSX', /missing/);
});
