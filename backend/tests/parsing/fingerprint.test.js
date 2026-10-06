// Transaction fingerprints (option A). Pure.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readCsvRows } from '../../src/parsing/readers/csvReader.js';
import { findHeader } from '../../src/parsing/columns.js';
import { normalizeRows } from '../../src/parsing/normalize.js';
import { addFingerprints } from '../../src/parsing/fingerprint.js';

const FIXTURES = fileURLToPath(new URL('../fixtures/statements/', import.meta.url));

async function fingerprinted(name) {
  const rows = [];
  for await (const row of readCsvRows(path.join(FIXTURES, name))) rows.push(row);
  const header = findHeader(rows);
  const { transactions } = await normalizeRows(rows.slice(header.index + 1), header);
  return addFingerprints(transactions);
}

const base = {
  line: 2,
  date: '2026-09-10',
  valueDate: null,
  description: 'UPI-CHAI POINT',
  reference: null,
  direction: 'debit',
  amountPaise: 2000,
  balancePaise: null,
};

test('every HDFC transaction gets a distinct fingerprint — both ₹20 CHAI POINT included', async () => {
  const transactions = await fingerprinted('hdfc_sep2026.csv');
  const fingerprints = new Set(transactions.map((t) => t.fingerprint));
  assert.equal(fingerprints.size, transactions.length);
  for (const t of transactions) assert.match(t.fingerprint, /^[0-9a-f]{64}$/);
});

test('the overlapping statement reproduces exactly the 30 shared fingerprints', async () => {
  const september = new Set((await fingerprinted('hdfc_sep2026.csv')).map((t) => t.fingerprint));
  const overlap = await fingerprinted('edge_hdfc_overlap_15sep_06oct.csv');

  const shared = overlap.filter((t) => september.has(t.fingerprint));
  assert.equal(overlap.length, 42);
  assert.equal(shared.length, 30);
  assert.ok(shared.every((t) => t.date >= '2026-09-15' && t.date <= '2026-09-30'));
  assert.ok(overlap.filter((t) => !september.has(t.fingerprint)).every((t) => t.date >= '2026-10-01'));
});

test('description is ignored when a reference or balance identifies the transaction', () => {
  const [app] = addFingerprints([{ ...base, reference: 'REF1', description: 'UPI-CHAI POINT-chaipoint@ybl' }]);
  const [netBanking] = addFingerprints([{ ...base, reference: 'REF1', description: 'UPI/CHAI POINT/Payment' }]);
  assert.equal(app.fingerprint, netBanking.fingerprint);
});

test('without reference and balance, the description is what tells rows apart', () => {
  const [chai] = addFingerprints([base]);
  const [coffee] = addFingerprints([{ ...base, description: 'UPI-COFFEE DAY' }]);
  assert.notEqual(chai.fingerprint, coffee.fingerprint);
  // …and wording differences in case/spacing don't matter.
  const [spaced] = addFingerprints([{ ...base, description: 'upi-chai   point' }]);
  assert.equal(chai.fingerprint, spaced.fingerprint);
});

test('two genuinely identical payments in one file stay two transactions (#1, #2)', () => {
  const [first, second] = addFingerprints([base, { ...base, line: 3 }]);
  assert.notEqual(first.fingerprint, second.fingerprint);

  // An overlapping statement with the same two rows numbers them the same way.
  const [againFirst, againSecond] = addFingerprints([{ ...base, line: 40 }, { ...base, line: 41 }]);
  assert.equal(againFirst.fingerprint, first.fingerprint);
  assert.equal(againSecond.fingerprint, second.fingerprint);
});

test('any change to date, direction, amount, reference or balance changes it', () => {
  const [original] = addFingerprints([{ ...base, reference: 'R', balancePaise: 100 }]);
  for (const change of [
    { date: '2026-09-11' },
    { direction: 'credit' },
    { amountPaise: 2001 },
    { reference: 'R2' },
    { balancePaise: 101 },
  ]) {
    const [changed] = addFingerprints([{ ...base, reference: 'R', balancePaise: 100, ...change }]);
    assert.notEqual(changed.fingerprint, original.fingerprint, JSON.stringify(change));
  }
});
