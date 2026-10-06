// Rows → transactions, skips and row errors. Pure: reader + header + normalize.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readCsvRows } from '../../src/parsing/readers/csvReader.js';
import { findHeader, LAYOUTS } from '../../src/parsing/columns.js';
import { normalizeRow, normalizeRows } from '../../src/parsing/normalize.js';
import { ParseError } from '../../src/parsing/errors.js';

const FIXTURES = fileURLToPath(new URL('../fixtures/statements/', import.meta.url));

async function parseFixture(name) {
  const rows = [];
  for await (const row of readCsvRows(path.join(FIXTURES, name))) rows.push(row);
  const header = findHeader(rows);
  return normalizeRows(rows.slice(header.index + 1), header);
}

const BANKS = {
  'hdfc_sep2026.csv': 54,
  'sbi_sep2026.csv': 56,
  'icici_sep2026.csv': 53,
  'axis_sep2026.csv': 46,
  'kotak_sep2026.csv': 47,
};

for (const [file, count] of Object.entries(BANKS)) {
  test(`${file}: every row parses and the running balance reconciles`, async () => {
    const { transactions, errors } = await parseFixture(file);

    assert.deepEqual(errors, []);
    assert.equal(transactions.length, count);

    // The strongest check we have: each balance must equal the previous one
    // minus this debit / plus this credit. A misread decimal point, a wrong
    // column or a flipped Dr/Cr anywhere breaks the chain.
    for (let i = 1; i < transactions.length; i++) {
      const previous = transactions[i - 1];
      const current = transactions[i];
      const change = current.direction === 'credit' ? current.amountPaise : -current.amountPaise;
      assert.equal(current.balancePaise, previous.balancePaise + change, `${file} line ${current.line}`);
    }
  });
}

test('HDFC: footer is skipped, both identical ₹20 CHAI POINT payments are kept', async () => {
  const { transactions, skipped } = await parseFixture('hdfc_sep2026.csv');
  assert.equal(skipped, 1); // "STATEMENT SUMMARY :-"

  const chai = transactions.filter((t) => t.date === '2026-09-10' && t.description.includes('CHAI POINT'));
  assert.equal(chai.length, 2);
  assert.deepEqual(chai.map((t) => t.amountPaise), [2000, 2000]);
  assert.notEqual(chai[0].reference, chai[1].reference);
});

test('a parsed transaction has exactly the expected shape and values', async () => {
  const { transactions } = await parseFixture('sbi_sep2026.csv');
  assert.deepEqual(transactions[0], {
    line: 12, // header is line 11 (see columns.test.js)
    date: '2026-09-01',
    valueDate: '2026-09-01',
    description: 'BY TRANSFER-NEFT*CITI0000002*CITIN006261933*ACME TECHNOLOGIES PVT LTD SALARY--',
    reference: '006261933122',
    direction: 'credit',
    amountPaise: 8500000,
    balancePaise: 13325000,
  });
});

test('ICICI "0.00" in the unused column counts as empty; "-" reference is null', async () => {
  const { transactions } = await parseFixture('icici_sep2026.csv');
  const salary = transactions.find((t) => t.description.includes('SALARY'));
  assert.equal(salary.direction, 'credit');
  assert.equal(salary.amountPaise, 8500000);
  assert.equal(salary.reference, null);
});

test('malformed file: 3 valid rows, every bad row reported with line and reason', async () => {
  const { transactions, errors, skipped } = await parseFixture('edge_malformed_rows.csv');

  assert.deepEqual(transactions.map((t) => t.line), [2, 9, 13]);
  assert.equal(transactions[1].amountPaise, 125000); // "1,250.00" inside quotes
  assert.equal(skipped, 1); // the ",,,,,," row

  assert.deepEqual(
    errors.map(({ line, code }) => ({ line, code })),
    [
      { line: 3, code: 'INVALID_DATE' },
      { line: 4, code: 'INVALID_AMOUNT' },
      { line: 5, code: 'NO_AMOUNT' },
      { line: 6, code: 'BOTH_DEBIT_AND_CREDIT' },
      { line: 7, code: 'MISSING_COLUMNS' },
      { line: 11, code: 'NEGATIVE_AMOUNT' },
      { line: 12, code: 'UNEXPECTED_EXTRA_COLUMNS' },
    ],
  );
  for (const error of errors) assert.ok(error.message.length > 0);
});

test('header-only file → ParseError NO_VALID_TRANSACTIONS', async () => {
  await assert.rejects(parseFixture('edge_header_only.csv'), (err) => {
    assert.ok(err instanceof ParseError);
    assert.equal(err.code, 'NO_VALID_TRANSACTIONS');
    assert.match(err.message, /no transactions/);
    return true;
  });
});

test('all rows bad → NO_VALID_TRANSACTIONS with the first errors attached', async () => {
  const header = { width: 3, layout: LAYOUTS.SPLIT, columns: { date: 0, description: 1, debit: 2, credit: 3 } };
  const rows = [{ line: 2, cells: ['99/99/99', 'X', '10.00', ''] }];
  await assert.rejects(normalizeRows(rows, header), (err) => {
    assert.equal(err.code, 'NO_VALID_TRANSACTIONS');
    assert.equal(err.details.errors[0].code, 'INVALID_DATE');
    return true;
  });
});

test('Kotak: an overdrawn (Dr) balance is stored as negative', () => {
  const header = {
    width: 5,
    layout: LAYOUTS.AMOUNT_WITH_FLAG,
    columns: { date: 0, description: 1, amount: 2, direction: 3, balance: 4, balanceDirection: 5 },
  };
  const result = normalizeRow({ line: 9, cells: ['01-09-2026', 'ATM', '500.00', 'DR', '1,200.00', 'DR'] }, { ...header, width: 6 });
  assert.equal(result.kind, 'transaction');
  assert.equal(result.transaction.balancePaise, -120000);
});

test('empty trailing cells are fine; filled extra cells are not', () => {
  const header = { width: 4, layout: LAYOUTS.SPLIT, columns: { date: 0, description: 1, debit: 2, credit: 3 } };
  assert.equal(normalizeRow({ line: 2, cells: ['01/09/26', 'UPI-OLA', '10.00', '', ''] }, header).kind, 'transaction');
  assert.equal(
    normalizeRow({ line: 3, cells: ['01/09/26', 'UPI-OLA', '10.00', '', 'X'] }, header).error.code,
    'UNEXPECTED_EXTRA_COLUMNS',
  );
});

test('descriptions: whitespace collapsed, capped at 500 characters', () => {
  const header = { width: 4, layout: LAYOUTS.SPLIT, columns: { date: 0, description: 1, debit: 2, credit: 3 } };
  const spaced = normalizeRow({ line: 2, cells: ['01/09/26', '  UPI   OLA  ', '10.00', ''] }, header);
  assert.equal(spaced.transaction.description, 'UPI OLA');

  const long = normalizeRow({ line: 3, cells: ['01/09/26', 'x'.repeat(2000), '10.00', ''] }, header);
  assert.equal(long.transaction.description.length, 500);

  const blank = normalizeRow({ line: 4, cells: ['01/09/26', '   ', '10.00', ''] }, header);
  assert.equal(blank.error.code, 'MISSING_DESCRIPTION');
});
