// Stage "validating", part 1: header detection and column mapping. Pure.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readCsvRows } from '../../src/parsing/readers/csvReader.js';
import {
  findHeader,
  mapHeader,
  normalizeHeading,
  pickFields,
  LAYOUTS,
  MAX_ROWS_BEFORE_HEADER,
} from '../../src/parsing/columns.js';
import { ParseError } from '../../src/parsing/errors.js';

const FIXTURES = fileURLToPath(new URL('../fixtures/statements/', import.meta.url));

async function rowsOf(name) {
  const rows = [];
  for await (const row of readCsvRows(path.join(FIXTURES, name))) rows.push(row);
  return rows;
}

test('normalizeHeading strips case, punctuation and extra spaces', () => {
  assert.equal(normalizeHeading('Withdrawal Amount (INR )'), 'withdrawal amount inr');
  assert.equal(normalizeHeading('Chq./Ref.No.'), 'chq ref no');
  assert.equal(normalizeHeading('  Dr / Cr '), 'dr cr');
  assert.equal(normalizeHeading('BAL'), 'bal');
});

// Expected column positions for each bank, read straight off the fixtures.
const BANKS = {
  'hdfc_sep2026.csv': {
    line: 6,
    layout: LAYOUTS.SPLIT,
    columns: { date: 0, valueDate: 3, description: 1, reference: 2, debit: 4, credit: 5, balance: 6 },
  },
  'sbi_sep2026.csv': {
    line: 11,
    layout: LAYOUTS.SPLIT,
    columns: { date: 0, valueDate: 1, description: 2, reference: 3, debit: 4, credit: 5, balance: 6 },
  },
  'icici_sep2026.csv': {
    line: 5,
    layout: LAYOUTS.SPLIT,
    columns: { date: 2, valueDate: 1, description: 4, reference: 3, debit: 5, credit: 6, balance: 7 },
  },
  'axis_sep2026.csv': {
    line: 4,
    layout: LAYOUTS.SPLIT,
    columns: { date: 0, description: 2, reference: 1, debit: 3, credit: 4, balance: 5 },
  },
  'kotak_sep2026.csv': {
    line: 4,
    layout: LAYOUTS.AMOUNT_WITH_FLAG,
    columns: {
      date: 1, valueDate: 2, description: 3, reference: 4,
      amount: 5, direction: 6, balance: 7, balanceDirection: 8,
    },
  },
};

for (const [file, expected] of Object.entries(BANKS)) {
  test(`${file}: header found past the preamble, columns mapped`, async () => {
    const rows = await rowsOf(file);
    const header = findHeader(rows);
    assert.equal(header.line, expected.line);
    assert.equal(header.width, rows[header.index].cells.length);
    assert.equal(header.layout, expected.layout);
    assert.deepEqual(header.columns, expected.columns);
  });
}

test('transaction date wins over value date (ICICI lists Value Date first)', () => {
  const { columns } = mapHeader(['Value Date', 'Transaction Date', 'Remarks', 'Debit', 'Credit']);
  assert.equal(columns.date, 1);
  assert.equal(columns.valueDate, 0);
});

test('Kotak: first Dr/Cr is the transaction direction, second is the balance side', async () => {
  const rows = await rowsOf('kotak_sep2026.csv');
  const header = findHeader(rows);
  const rent = rows.find((r) => r.cells[3]?.includes('RENT'));

  const fields = pickFields(rent.cells, header.columns);
  assert.equal(fields.amount, '22,000.00');
  assert.equal(fields.direction, 'DR');
  assert.equal(fields.balance, '1,12,984.90');
  assert.equal(fields.balanceDirection, 'CR');
});

test('pickFields returns raw strings by field name; missing cells are undefined', async () => {
  const rows = await rowsOf('hdfc_sep2026.csv');
  const header = findHeader(rows);
  const firstTransaction = rows[header.index + 1];

  assert.deepEqual(pickFields(firstTransaction.cells, header.columns), {
    date: '01/09/26',
    valueDate: '01/09/26',
    description: 'ACH D- AIRTEL BROADBAND-00626611',
    reference: '0000006266119255',
    debit: '936.45',
    credit: '',
    balance: '47313.55',
  });

  const short = pickFields(['06/09/26', 'SHORT ROW'], header.columns);
  assert.equal(short.debit, undefined);
});

test('headings in odd casing and spacing still match', () => {
  const mapped = mapHeader(['  DATE ', 'narration', 'WITHDRAWAL AMT', 'deposit amt.', 'Closing  Balance']);
  assert.equal(mapped.layout, LAYOUTS.SPLIT);
  assert.equal(mapped.columns.balance, 4);
});

test('a header with only one of debit/credit and no amount is not a header', () => {
  assert.equal(mapHeader(['Date', 'Narration', 'Debit', 'Balance']), null);
});

test('amount without a Dr/Cr column is not enough (direction unknown)', () => {
  assert.equal(mapHeader(['Date', 'Description', 'Amount', 'Balance']), null);
});

test('header-only file: header found (having no rows is a later check)', async () => {
  const rows = await rowsOf('edge_header_only.csv');
  const header = findHeader(rows);
  assert.equal(header.index, rows.length - 1);
});

test('unrelated CSV → ParseError UNRECOGNIZED_FORMAT', async () => {
  for (const file of ['edge_unrecognized_format.csv', 'edge_corrupt_binary.csv']) {
    const rows = await rowsOf(file);
    assert.throws(() => findHeader(rows), (err) => {
      assert.ok(err instanceof ParseError, file);
      assert.equal(err.code, 'UNRECOGNIZED_FORMAT');
      return true;
    });
  }
});

test(`a header after ${MAX_ROWS_BEFORE_HEADER} rows of preamble is not searched for`, () => {
  const preamble = Array.from({ length: MAX_ROWS_BEFORE_HEADER }, (_, i) => ({ line: i + 1, cells: ['info'] }));
  const rows = [...preamble, { line: 31, cells: ['Date', 'Narration', 'Debit', 'Credit'] }];
  assert.throws(() => findHeader(rows), { code: 'UNRECOGNIZED_FORMAT' });

  rows.splice(0, 1); // header now at row 30 → found
  assert.equal(findHeader(rows).line, 31);
});
