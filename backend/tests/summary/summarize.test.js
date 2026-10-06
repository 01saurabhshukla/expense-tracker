// The statement summary. Pure.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { summarize } from '../../src/summary/summarize.js';

const t = (date, direction, amountPaise, category) => ({
  line: 1, date, direction, amountPaise, category, balancePaise: null,
});

const transactions = [
  t('2026-09-30', 'debit', 50000, 'food_dining'),
  t('2026-09-01', 'credit', 8500000, 'salary'),
  t('2026-10-02', 'debit', 2000000, 'rent'),
  t('2026-09-15', 'debit', 25000, 'food_dining'),
];

test('period, totals and net (money in minus money out)', () => {
  const summary = summarize(transactions);
  assert.deepEqual(summary.period, { from: '2026-09-01', to: '2026-10-02' });
  assert.deepEqual(summary.totals, { count: 4, debitPaise: 2075000, creditPaise: 8500000, netPaise: 6425000 });
});

test('by category: only categories that appear, in the category list order', () => {
  assert.deepEqual(summarize(transactions).byCategory, [
    { category: 'food_dining', count: 2, debitPaise: 75000, creditPaise: 0, netPaise: -75000 },
    { category: 'rent', count: 1, debitPaise: 2000000, creditPaise: 0, netPaise: -2000000 },
    { category: 'salary', count: 1, debitPaise: 0, creditPaise: 8500000, netPaise: 8500000 },
  ]);
});

test('by month: oldest first, a statement can span months', () => {
  assert.deepEqual(summarize(transactions).byMonth, [
    { month: '2026-09', count: 3, debitPaise: 75000, creditPaise: 8500000, netPaise: 8425000 },
    { month: '2026-10', count: 1, debitPaise: 2000000, creditPaise: 0, netPaise: -2000000 },
  ]);
});

test('the categories add up to the totals (nothing counted twice or lost)', () => {
  const summary = summarize(transactions);
  const sum = (key) => summary.byCategory.reduce((total, row) => total + row[key], 0);
  assert.equal(sum('count'), summary.totals.count);
  assert.equal(sum('debitPaise'), summary.totals.debitPaise);
  assert.equal(sum('creditPaise'), summary.totals.creditPaise);
});
