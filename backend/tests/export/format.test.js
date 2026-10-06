// Formatting for exports, and what happens when a download fails midway. Pure.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatRupees, plainRupees, formatDate, csvCell, csvLine } from '../../src/export/format.js';
import { errorHandler } from '../../src/middleware/errorHandler.js';

test('rupees: Indian grouping for reading, plain for spreadsheets, never floats', () => {
  assert.equal(formatRupees(13325000), '1,33,250.00');
  assert.equal(formatRupees(5), '0.05');
  assert.equal(formatRupees(-1000050), '-10,000.50');
  assert.equal(formatRupees(null), '');
  assert.equal(plainRupees(13325000), '133250.00');
  assert.equal(plainRupees(-5), '-0.05');
  // 0.1 + 0.2 style errors can't happen: paise are integers until the end.
  assert.equal(plainRupees(30), '0.30');
});

test('dates are shown day-first', () => {
  assert.equal(formatDate('2026-09-01'), '01/09/2026');
});

test('CSV cells: quoting', () => {
  assert.equal(csvCell('plain'), 'plain');
  assert.equal(csvCell('a,b'), '"a,b"');
  assert.equal(csvCell('say "hi"'), '"say ""hi"""');
  assert.equal(csvCell('two\nlines'), '"two\nlines"');
  assert.equal(csvCell(null), '');
  assert.equal(csvLine(['a', 'b']), 'a,b\r\n');
});

test('CSV cells: text that a spreadsheet would run as a formula is neutralised', () => {
  for (const evil of ['=1+2', '+1', '-1+2', '@SUM(A1)', '\t=1', '\r=1']) {
    assert.ok(csvCell(evil).replace(/^"/, '').startsWith("'"), JSON.stringify(evil));
  }
  // Numbers we write ourselves (a negative balance) are not text: left alone.
  assert.equal(csvCell('-500.00', { text: false }), '-500.00');
});

test('an error after a download started cuts the connection instead of sending JSON', () => {
  let destroyed = false;
  let jsonSent = false;
  const res = { headersSent: true, destroy: () => (destroyed = true), status: () => res, json: () => (jsonSent = true) };
  const originalError = console.error;
  console.error = () => {}; // keep the test output clean
  try {
    errorHandler(new Error('db went away'), { id: 'req-1' }, res, () => {});
  } finally {
    console.error = originalError;
  }
  assert.equal(destroyed, true);
  assert.equal(jsonSent, false);
});
