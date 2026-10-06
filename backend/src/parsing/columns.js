import { ParseError } from './errors.js';

// The header must appear within this many rows (SBI's preamble is ~11 rows).
export const MAX_ROWS_BEFORE_HEADER = 30;

// Known names for each field, after normalizeHeading(). Order matters: for
// each field the first alias found wins, so "transaction date" beats "date",
// and a column can only be claimed by one field.
//
// Fields are claimed in this object's order. That's why `direction` comes
// before `balanceDirection`: Kotak has two "Dr / Cr" columns, and the first
// one (next to Amount) is the transaction's direction.
const FIELD_ALIASES = {
  date: ['transaction date', 'txn date', 'tran date', 'date'],
  valueDate: ['value date', 'value dt'],
  description: ['narration', 'description', 'particulars', 'transaction remarks', 'remarks'],
  reference: ['chq ref no', 'ref no cheque no', 'cheque number', 'cheque no', 'chqno'],
  debit: ['withdrawal amt', 'withdrawal amount inr', 'withdrawal amount', 'withdrawals', 'debit amount', 'debit', 'dr'],
  credit: ['deposit amt', 'deposit amount inr', 'deposit amount', 'deposits', 'credit amount', 'credit', 'cr'],
  amount: ['transaction amount', 'amount inr', 'amount'],
  direction: ['dr cr', 'cr dr'],
  balance: ['closing balance', 'balance inr', 'balance', 'bal'],
  balanceDirection: ['dr cr', 'cr dr'],
};

// The two ways banks express "money out" vs "money in".
export const LAYOUTS = {
  SPLIT: 'split', // separate Debit and Credit columns (HDFC, SBI, ICICI, Axis)
  AMOUNT_WITH_FLAG: 'amount-with-flag', // one Amount column + a Dr/Cr column (Kotak)
};

// "Withdrawal Amount (INR )" → "withdrawal amount inr"; "Chq./Ref.No." → "chq ref no"
export function normalizeHeading(text) {
  return String(text).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

// Tries to read one row as a header. Returns { columns, layout } if the row
// names everything we need, otherwise null.
export function mapHeader(cells) {
  const headings = cells.map(normalizeHeading);
  const claimed = new Set();
  const columns = {};

  for (const [field, aliases] of Object.entries(FIELD_ALIASES)) {
    for (const alias of aliases) {
      const index = headings.findIndex((heading, i) => heading === alias && !claimed.has(i));
      if (index !== -1) {
        columns[field] = index;
        claimed.add(index);
        break;
      }
    }
  }

  const layout =
    columns.debit !== undefined && columns.credit !== undefined
      ? LAYOUTS.SPLIT
      : columns.amount !== undefined && columns.direction !== undefined
        ? LAYOUTS.AMOUNT_WITH_FLAG
        : null;

  if (columns.date === undefined || columns.description === undefined || !layout) return null;
  return { columns, layout };
}

// Stage "validating", part 1: find the header among the first rows.
// `rows` are { line, cells } from a reader. Everything before the header is
// preamble (bank name, account details) and is ignored.
//
// Returns { index, line, columns, layout }: `index` is the header's position
// in `rows`, so data rows start at index + 1.
export function findHeader(rows) {
  const limit = Math.min(rows.length, MAX_ROWS_BEFORE_HEADER);
  for (let index = 0; index < limit; index++) {
    const mapped = mapHeader(rows[index].cells);
    if (mapped) return { index, line: rows[index].line, ...mapped };
  }

  throw new ParseError(
    'UNRECOGNIZED_FORMAT',
    `This doesn't look like a bank statement: no row in the first ${MAX_ROWS_BEFORE_HEADER} names a ` +
      'date, a description and the amounts. Supported: HDFC, SBI, ICICI, Axis and Kotak exports.',
  );
}

// Picks a data row's cells by field name. Values stay raw strings (or
// undefined when the row is too short); turning them into dates and paise is
// the next step's job.
export function pickFields(cells, columns) {
  const fields = {};
  for (const [field, index] of Object.entries(columns)) fields[field] = cells[index];
  return fields;
}
