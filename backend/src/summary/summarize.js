import { CATEGORIES } from '../categorize/categories.js';
import { checkRunningBalance } from './balance.js';

// Stage "summarizing": what this statement says, in a few numbers.
//
// It describes the FILE: every transaction found in it, including rows that
// were already imported from an overlapping statement (those are skipped when
// saving, but they are still part of this statement). The dashboard, later,
// answers questions across all of a user's statements from the database.
//
// All amounts are whole paise (integers), like everywhere else.
export function summarize(transactions) {
  const dates = transactions.map((t) => t.date).sort(); // ISO dates sort as text
  return {
    period: { from: dates[0], to: dates.at(-1) },
    totals: add(emptyTotals(), transactions),
    byCategory: byCategory(transactions),
    byMonth: byMonth(transactions),
    balance: checkRunningBalance(transactions),
  };
}

function emptyTotals() {
  return { count: 0, debitPaise: 0, creditPaise: 0, netPaise: 0 };
}

function add(totals, transactions) {
  for (const t of transactions) {
    totals.count++;
    if (t.direction === 'debit') totals.debitPaise += t.amountPaise;
    else totals.creditPaise += t.amountPaise;
  }
  totals.netPaise = totals.creditPaise - totals.debitPaise;
  return totals;
}

// Only categories that appear, in the fixed order of the category list.
function byCategory(transactions) {
  return CATEGORIES.map(({ key }) => ({
    category: key,
    ...add(emptyTotals(), transactions.filter((t) => t.category === key)),
  })).filter((row) => row.count > 0);
}

// "2026-09-14" → "2026-09". Oldest month first.
function byMonth(transactions) {
  const months = new Map();
  for (const t of transactions) {
    const month = t.date.slice(0, 7);
    if (!months.has(month)) months.set(month, []);
    months.get(month).push(t);
  }
  return [...months.keys()].sort().map((month) => ({ month, ...add(emptyTotals(), months.get(month)) }));
}
