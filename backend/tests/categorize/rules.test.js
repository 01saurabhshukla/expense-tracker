// Categorization rules, merchant keys and the evaluation set. Pure.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { categorizeByRules } from '../../src/categorize/rules.js';
import { merchantKey } from '../../src/categorize/merchant.js';
import { categorizeTransactions } from '../../src/categorize/categorize.js';
import { evaluateRules } from '../../src/categorize/evaluate.js';
import { CATEGORY_KEYS } from '../../src/categorize/categories.js';

const debit = (description) => ({ description, direction: 'debit' });
const credit = (description) => ({ description, direction: 'credit' });
const categoryOf = (t) => categorizeByRules(t)?.category ?? 'uncategorized';

test('evaluation set: every sample transaction gets its hand label', async () => {
  const labels = JSON.parse(
    await readFile(new URL('../fixtures/categorization/labels.json', import.meta.url), 'utf8'),
  );
  const report = evaluateRules(labels);

  assert.equal(report.total, 256);
  assert.deepEqual(report.wrong, [], 'a wrong category misleads the user');
  assert.deepEqual(report.uncategorized, []);
  for (const label of labels) assert.ok(CATEGORY_KEYS.includes(label.expected), label.expected);
});

test('trap: SBI card purchases say "POS ATM PURCH" but are NOT cash withdrawals', () => {
  assert.equal(categoryOf(debit('POS ATM PURCH OTHPG 3115 HPCL PETROL--')), 'fuel');
  assert.equal(categoryOf(debit('POS ATM PURCH OTHPG 3115 NETFLIX--')), 'entertainment');
});

test('real cash withdrawals in every bank wording', () => {
  for (const d of [
    'NWD-416021XXXXXX4821-S1AWVR02-VIRAR WEST',
    'ATM WDL-ATM CASH 3115 VIRAR WEST MAHARASHTRA--',
    'ATM/CASH WDL/VIRAR WEST/006261',
    'ATM-CASH/VIRAR WEST/AXIS',
    'ATL/4821/VIRAR WEST/CASH WDL',
  ]) {
    assert.equal(categoryOf(debit(d)), 'cash', d);
  }
});

test('direction matters: "SALARY" only counts as salary when money comes in', () => {
  assert.equal(categoryOf(credit('NEFT/CITIN0062/ACME TECHNOLOGIES PVT LTD SALARY')), 'salary');
  assert.notEqual(categoryOf(debit('NEFT/SALARY ADVANCE REPAYMENT')), 'salary');
});

test('whole words only: OLA is not KOLAR, RENT is not CURRENT', () => {
  assert.equal(categoryOf(debit('UPI-OLA-olacabs@ybl-HDFC0000001-1-UPI')), 'transport');
  assert.equal(categoryOf(debit('POS 4160 KOLAR STORES')), 'uncategorized');
  assert.equal(categoryOf(debit('UPI/RAMESH KUMAR RENT/0062/UPI Payment')), 'rent');
  assert.equal(categoryOf(debit('CURRENT ACCOUNT CHARGES')), 'uncategorized');
});

test('merchants beat transfer rules: UPI to SWIGGY is food, not a transfer', () => {
  assert.equal(categoryOf(debit('UPI/P2M/0062/SWIGGY/swiggy@icici/AXIS BANK')), 'food_dining');
});

test('money to and from people', () => {
  assert.equal(categoryOf(credit('IMPS/P2A/0062/PRIYA SHUKLA')), 'transfers_in');
  assert.equal(categoryOf(debit('IMPS/0062/ANIL SHARMA/LOAN')), 'transfers_out');
  assert.equal(categoryOf(debit('UPI/0062/ANIL SHARMA/anil.s@okhdfcbank/Pay')), 'transfers_out');
});

test('an unknown merchant stays uncategorized instead of being guessed', () => {
  assert.equal(categoryOf(debit('UPI-UNKNOWN MERCHANT XYZ-xyz@ybl-HDFC0000001-1-UPI')), 'uncategorized');
});

test('merchant key: UPI handle when present, same across banks', () => {
  assert.equal(merchantKey('UPI-SWIGGY-swiggy@icici-HDFC0000001-006266952889-UPI'), 'swiggy@icici');
  assert.equal(merchantKey('TO TRANSFER-UPI/DR/0062/SWIGGY/YESB/swiggy@icici/Payment--'), 'swiggy@icici');
  // HDFC separates fields with "-": the handle must not swallow the name before it.
  assert.equal(merchantKey('UPI-MAHANAGAR GAS-mgl@hdfcbank-HDFC0000001-0062-UPI'), 'mgl@hdfcbank');
});

test('merchant key: cleaned name when there is no handle', () => {
  assert.equal(merchantKey('POS 416021XXXXXX4821 NETFLIX'), 'NETFLIX');
  assert.equal(merchantKey('POS ATM PURCH OTHPG 3115 AMAZON PAY--'), 'AMAZON PAY');
  assert.equal(merchantKey('ACH D- MSEDCL ELECTRICITY-00626611'), 'MSEDCL ELECTRICITY');
  assert.equal(merchantKey('UPI/006261720886/MAHANAGAR GAS/mgl@hdfcbank/Pay to merchant'), 'mgl@hdfcbank');
  assert.equal(merchantKey('UPI/SWIGGY/006269/UPI Payment'), 'SWIGGY');
  assert.equal(merchantKey('0000 1234'), null);
});

test("the user's correction wins over every rule", () => {
  const overrides = new Map([['swiggy@icici', 'groceries']]);
  const { transactions, counts } = categorizeTransactions(
    [
      { ...debit('UPI-SWIGGY-swiggy@icici-HDFC0000001-1-UPI') },
      { ...debit('UPI-ZOMATO-zomato@hdfcbank-HDFC0000001-2-UPI') },
      { ...debit('UPI-NEW SHOP-shop@ybl-HDFC0000001-3-UPI') },
    ],
    overrides,
  );

  assert.deepEqual(
    transactions.map((t) => [t.merchantKey, t.category, t.categorySource]),
    [
      ['swiggy@icici', 'groceries', 'user'],
      ['zomato@hdfcbank', 'food_dining', 'rule'],
      ['shop@ybl', 'uncategorized', 'none'],
    ],
  );
  assert.deepEqual(counts, { user: 1, rule: 1, none: 1 });
});
