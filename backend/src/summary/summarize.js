import { CATEGORIES } from '../categorize/categories.js';
import { createBalanceCheck } from './balance.js';

// Stage "summarizing": what this statement says, in a few numbers.
//
// It describes the FILE: every transaction found in it, including rows that
// were already imported from an overlapping statement (those are skipped when
// saving, but they are still part of this statement). The dashboard, later,
// answers questions across all of a user's statements from the database.
//
// Built ONE TRANSACTION AT A TIME (7i), so a huge statement is summarized
// without being held in memory:
//   const summary = createSummary();
//   for (const t of transactions) summary.add(t);
//   summary.result();
//
// All amounts are whole paise (integers), like everywhere else.
export function createSummary() {
  let from = null;
  let to = null;
  const totals = emptyTotals();
  const categories = new Map(); // key → totals
  const months = new Map(); // "2026-09" → totals
  const balance = createBalanceCheck();

  return {
    add(t) {
      if (from === null || t.date < from) from = t.date; // ISO dates compare as text
      if (to === null || t.date > to) to = t.date;
      add(totals, t);
      add(getOrCreate(categories, t.category), t);
      add(getOrCreate(months, t.date.slice(0, 7)), t);
      balance.add(t);
    },

    result() {
      return {
        period: { from, to },
        totals: withNet(totals),
        // Only categories that appear, in the fixed order of the category list.
        byCategory: CATEGORIES.filter(({ key }) => categories.has(key)).map(({ key }) => ({
          category: key,
          ...withNet(categories.get(key)),
        })),
        // Oldest month first.
        byMonth: [...months.keys()].sort().map((month) => ({ month, ...withNet(months.get(month)) })),
        balance: balance.result(),
      };
    },
  };
}

// The whole summary for an array of transactions.
export function summarize(transactions) {
  const summary = createSummary();
  for (const t of transactions) summary.add(t);
  return summary.result();
}

function emptyTotals() {
  return { count: 0, debitPaise: 0, creditPaise: 0 };
}

function getOrCreate(map, key) {
  if (!map.has(key)) map.set(key, emptyTotals());
  return map.get(key);
}

function add(totals, t) {
  totals.count++;
  if (t.direction === 'debit') totals.debitPaise += t.amountPaise;
  else totals.creditPaise += t.amountPaise;
}

function withNet(totals) {
  return { ...totals, netPaise: totals.creditPaise - totals.debitPaise };
}
