// Single-cell parsers: dates, amounts, Dr/Cr. Pure.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseDate, parseAmountPaise, parseDirection } from '../../src/parsing/values.js';

test('dates: every format the five banks use', () => {
  for (const [raw, expected] of [
    ['01/09/26', '2026-09-01'], // HDFC
    ['1 Sep 2026', '2026-09-01'], // SBI
    ['01/09/2026', '2026-09-01'], // ICICI
    ['01-09-2026', '2026-09-01'], // Axis, Kotak
    ['01-Sep-2026', '2026-09-01'],
    [' 30/09/26 ', '2026-09-30'],
    ['29/02/2028', '2028-02-29'], // leap year
  ]) {
    assert.deepEqual(parseDate(raw), { value: expected }, raw);
  }
});

test('dates: impossible or out-of-range dates are rejected', () => {
  for (const raw of ['32/13/26', '31/02/2026', '29/02/2026', '00/09/2026', '1 Foo 2026', '2026-09-01', 'STATEMENT SUMMARY :-', '', undefined, '01/09/1999']) {
    const result = parseDate(raw);
    assert.equal(result.error?.code, 'INVALID_DATE', String(raw));
  }
});

test('amounts become whole paise, with no floating-point rounding', () => {
  for (const [raw, expected] of [
    ['936.45', 93645],
    ['85000.00', 8500000],
    ['1,33,250.00', 13325000], // Indian grouping
    ['22,000.00', 2200000],
    ['133,250.00', 13325000], // Western grouping
    ['0.1', 10],
    ['20', 2000],
    ['1,302.91', 130291],
  ]) {
    assert.deepEqual(parseAmountPaise(raw), { value: expected }, raw);
  }
  // The classic float trap: 0.1 + 0.2 !== 0.3, but 10 + 20 === 30 paise.
  assert.equal(parseAmountPaise('0.10').value + parseAmountPaise('0.20').value, parseAmountPaise('0.30').value);
});

test('empty cells are "no amount", not zero and not an error', () => {
  for (const raw of ['', ' ', '-', undefined]) assert.deepEqual(parseAmountPaise(raw), { value: null }, String(raw));
  assert.deepEqual(parseAmountPaise('0.00'), { value: 0 });
});

test('bad amounts are rejected with a specific code', () => {
  assert.equal(parseAmountPaise('abc').error.code, 'INVALID_AMOUNT');
  assert.equal(parseAmountPaise('1,2,3').error.code, 'INVALID_AMOUNT'); // broken grouping
  assert.equal(parseAmountPaise('12.345').error.code, 'INVALID_AMOUNT'); // 3 decimals
  assert.equal(parseAmountPaise('1 250').error.code, 'INVALID_AMOUNT');
  assert.equal(parseAmountPaise('-500.00').error.code, 'NEGATIVE_AMOUNT');
  assert.equal(parseAmountPaise('(500.00)').error.code, 'NEGATIVE_AMOUNT');
  // An account number pasted into the amount column:
  assert.equal(parseAmountPaise('5010012345678901').error.code, 'AMOUNT_TOO_LARGE');
});

test('Dr/Cr flags in their common spellings', () => {
  assert.deepEqual(parseDirection('DR'), { value: 'debit' });
  assert.deepEqual(parseDirection(' cr '), { value: 'credit' });
  assert.deepEqual(parseDirection('Debit'), { value: 'debit' });
  assert.equal(parseDirection('XX').error.code, 'INVALID_DIRECTION');
  assert.equal(parseDirection('').error.code, 'INVALID_DIRECTION');
});
