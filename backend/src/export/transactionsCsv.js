import { once } from 'node:events';
import { CATEGORIES } from '../categorize/categories.js';
import { listTransactionsAfter } from '../db/queries/transactions.js';
import { csvCell, csvLine, formatDate, plainRupees } from './format.js';

// Rows fetched from the database per round trip.
const PAGE_SIZE = 2000;

const HEADER = ['Date', 'Description', 'Reference', 'Debit', 'Credit', 'Balance', 'Category', 'Categorized by', 'Merchant'];
const CATEGORY_NAMES = new Map(CATEGORIES.map((c) => [c.key, c.name]));
const SOURCE_NAMES = { user: 'You', rule: 'Rule', llm: 'AI', none: '' };

// Streams every matching transaction as CSV, oldest first, a page at a
// time: memory stays flat however many rows there are. Pages are "rows after
// the last one sent" (keyset), so page 500 costs the same as page 1.
export async function writeTransactionsCsv(userId, filters, res) {
  // The BOM tells Excel the file is UTF-8 (otherwise "₹" or "é" turn into junk).
  if (!(await write(res, `﻿${csvLine(HEADER.map((h) => csvCell(h)))}`))) return;

  let after = null;
  for (;;) {
    const rows = await listTransactionsAfter(userId, filters, after, PAGE_SIZE);
    if (!(await write(res, rows.map(toCsvLine).join('')))) return; // the client went away
    if (rows.length < PAGE_SIZE) break;
    after = rows.at(-1);
  }
  res.end();
}

function toCsvLine(t) {
  const isDebit = t.direction === 'debit';
  return csvLine([
    csvCell(formatDate(t.date)),
    csvCell(t.description),
    csvCell(t.reference),
    csvCell(isDebit ? plainRupees(t.amountPaise) : '', { text: false }),
    csvCell(isDebit ? '' : plainRupees(t.amountPaise), { text: false }),
    csvCell(plainRupees(t.balancePaise), { text: false }), // may be negative: a number, not a formula
    csvCell(CATEGORY_NAMES.get(t.category) ?? t.category),
    csvCell(SOURCE_NAMES[t.categorySource] ?? ''),
    csvCell(t.merchantKey),
  ]);
}

// Writes respecting backpressure: if the client reads slowly, wait for it
// instead of piling rows up in memory. Returns false if the client
// disconnected (nothing more should be written).
async function write(res, chunk) {
  if (res.destroyed) return false;
  if (!res.write(chunk)) {
    await Promise.race([once(res, 'drain'), once(res, 'close')]);
  }
  return !res.destroyed;
}
