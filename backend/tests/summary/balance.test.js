// The running-balance check. Pure.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkRunningBalance } from '../../src/summary/balance.js';

// Opening balance ₹1,000.00, then -₹200, +₹500, -₹50.
const rows = [
  { line: 2, direction: 'debit', amountPaise: 20000, balancePaise: 80000 },
  { line: 3, direction: 'credit', amountPaise: 50000, balancePaise: 130000 },
  { line: 4, direction: 'debit', amountPaise: 5000, balancePaise: 125000 },
];

test('every row adds up: ok, with opening and closing balances', () => {
  assert.deepEqual(checkRunningBalance(rows), {
    status: 'ok',
    order: 'oldest_first',
    checkedRows: 2,
    openingPaise: 100000,
    closingPaise: 125000,
    mismatchCount: 0,
    mismatches: [],
  });
});

test('a newest-first export is recognised and checked in that order', () => {
  const result = checkRunningBalance([...rows].reverse());
  assert.equal(result.status, 'ok');
  assert.equal(result.order, 'newest_first');
  assert.equal(result.openingPaise, 100000);
  assert.equal(result.closingPaise, 125000);
});

test('a missing row shows up as a mismatch on the row after the gap', () => {
  const result = checkRunningBalance([rows[0], rows[2]]); // the ₹500 credit is gone
  assert.equal(result.status, 'mismatch');
  assert.equal(result.mismatchCount, 1);
  assert.deepEqual(result.mismatches, [{ line: 4, expectedPaise: 75000, actualPaise: 125000 }]);
});

test('a misread direction is caught', () => {
  const misread = rows.map((r) => (r.line === 4 ? { ...r, direction: 'credit' } : r));
  assert.equal(checkRunningBalance(misread).status, 'mismatch');
});

test('an overdrawn (negative) balance is checked like any other', () => {
  const overdrawn = [
    { line: 2, direction: 'debit', amountPaise: 30000, balancePaise: -10000 },
    { line: 3, direction: 'credit', amountPaise: 15000, balancePaise: 5000 },
  ];
  const result = checkRunningBalance(overdrawn);
  assert.equal(result.status, 'ok');
  assert.equal(result.openingPaise, 20000);
});

test('no balance column: unavailable, nothing is guessed', () => {
  const result = checkRunningBalance(rows.map((r) => ({ ...r, balancePaise: null })));
  assert.equal(result.status, 'unavailable');
  assert.equal(result.order, null);
  assert.equal(result.openingPaise, null);
});

test('rows without a balance are skipped, not compared across', () => {
  const gappy = [rows[0], { ...rows[1], balancePaise: null }, rows[2]];
  const result = checkRunningBalance(gappy);
  // Row 2 → (no balance) → row 4: no neighbouring pair has two balances.
  assert.equal(result.status, 'unavailable');
  assert.equal(result.checkedRows, 0);
});
