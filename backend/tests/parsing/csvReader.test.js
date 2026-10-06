// Stage "reading" for CSV. Pure: no app, no database.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readCsvRows } from '../../src/parsing/readers/csvReader.js';
import { ParseError } from '../../src/parsing/errors.js';

const FIXTURES = fileURLToPath(new URL('../fixtures/statements/', import.meta.url));
const scratch = await mkdtemp(path.join(tmpdir(), 'csv-reader-test-'));
after(() => rm(scratch, { recursive: true, force: true }));

async function readAll(filePath) {
  const rows = [];
  for await (const row of readCsvRows(filePath)) rows.push(row);
  return rows;
}

const fixture = (name) => readAll(path.join(FIXTURES, name));

async function fromText(content) {
  const file = path.join(scratch, `${Math.random()}.csv`);
  await writeFile(file, content);
  return file;
}

test('HDFC: preamble rows come through untouched; header is on line 6', async () => {
  const rows = await fixture('hdfc_sep2026.csv');

  assert.deepEqual(rows[0], { line: 1, cells: ['HDFC BANK Ltd.', '', '', '', '', '', ''] });
  // Line 5 is blank, so it's skipped — but line numbers stay true to the file.
  const header = rows.find((r) => r.cells[0] === 'Date');
  assert.equal(header.line, 6);
  assert.deepEqual(header.cells, [
    'Date', 'Narration', 'Chq./Ref.No.', 'Value Dt', 'Withdrawal Amt.', 'Deposit Amt.', 'Closing Balance',
  ]);
});

test('Windows line endings (CRLF) leave no stray \\r in any cell', async () => {
  for (const name of ['hdfc_sep2026.csv', 'sbi_sep2026.csv', 'icici_sep2026.csv', 'axis_sep2026.csv', 'kotak_sep2026.csv']) {
    const rows = await fixture(name);
    assert.ok(rows.length > 40, `${name} should have its transactions`);
    for (const { cells } of rows) {
      for (const cell of cells) assert.ok(!cell.includes('\r'), `${name}: \\r in ${JSON.stringify(cell)}`);
    }
  }
});

test('SBI: quoted Indian-format amounts stay one cell, commas and all', async () => {
  const rows = await fixture('sbi_sep2026.csv');

  const address = rows.find((r) => r.cells[0] === 'Address');
  assert.equal(address.cells[2], 'VIRAR WEST, PALGHAR');

  const salary = rows.find((r) => r.cells[2]?.includes('SALARY'));
  assert.equal(salary.cells.length, 7);
  assert.equal(salary.cells[5], '85,000.00');
  assert.equal(salary.cells[6], '1,33,250.00');
  // SBI writes blank cells as a single space; the reader keeps it (7c trims).
  assert.equal(salary.cells[4], ' ');
});

test('Kotak: amount and its Dr/Cr flag arrive as separate cells', async () => {
  const rows = await fixture('kotak_sep2026.csv');
  const rent = rows.find((r) => r.cells[3]?.includes('RENT'));
  assert.deepEqual(rent.cells.slice(5, 9), ['22,000.00', 'DR', '1,12,984.90', 'CR']);
});

test('malformed rows: shape is preserved for the next stage to judge', async () => {
  const rows = await fixture('edge_malformed_rows.csv');
  const byLine = Object.fromEntries(rows.map((r) => [r.line, r.cells]));

  assert.equal(byLine[7].length, 2, 'short row keeps its 2 cells');
  assert.equal(byLine[8], undefined, 'blank line 8 is skipped');
  assert.match(byLine[9][1], /, extra comma in narration$/, 'quoted comma stays inside the cell');
  assert.equal(byLine[9][4], '1,250.00');
  assert.deepEqual(byLine[10], ['', '', '', '', '', '', ''], 'a row of only commas still comes through');
  assert.equal(byLine[12].length, 9, 'extra columns are kept');
  assert.equal(byLine[4][4], 'abc', 'text in an amount column is not judged here');
});

test('a UTF-8 BOM at the start is removed', async () => {
  const rows = await readAll(await fromText('﻿Date,Amount\r\n01/09/26,10.00\r\n'));
  assert.deepEqual(rows[0].cells, ['Date', 'Amount']);
});

test('a stray quote inside an unquoted cell is kept as a character', async () => {
  const rows = await readAll(await fromText('Date,Narration\n01/09/26,POS ABC"S STORE\n'));
  assert.equal(rows[1].cells[1], 'POS ABC"S STORE');
});

test('a quoted value that is never closed → ParseError MALFORMED_CSV with a line number', async () => {
  const file = await fromText('Date,Narration\n01/09/26,"UPI-SWIGGY\n02/09/26,UPI-OLA\n');
  await assert.rejects(readAll(file), (err) => {
    assert.ok(err instanceof ParseError);
    assert.equal(err.code, 'MALFORMED_CSV');
    assert.equal(typeof err.line, 'number');
    assert.match(err.message, /never closed/);
    return true;
  });
});

test('a single enormous cell → ParseError instead of eating memory', async () => {
  const file = await fromText(`Date,Narration\n01/09/26,${'x'.repeat(100 * 1024)}\n`);
  await assert.rejects(readAll(file), { code: 'MALFORMED_CSV' });
});

test('a file that cannot be read throws instead of hanging forever', async () => {
  // Regression: with a plain .pipe(), a missing file left the loop waiting.
  await assert.rejects(readAll(path.join(scratch, 'does-not-exist.csv')), { code: 'ENOENT' });
});

test('files the upload gate let through are read, not judged', async () => {
  const header = await fixture('edge_header_only.csv');
  assert.equal(header.length, 1);

  const vvv = await fixture('edge_corrupt_binary.csv');
  assert.equal(vvv.length, 1);
  assert.equal(vvv[0].cells[0].length, 4096);

  const people = await fixture('edge_unrecognized_format.csv');
  assert.deepEqual(people[0].cells, ['Name', 'Email', 'Phone', 'City']);
});
