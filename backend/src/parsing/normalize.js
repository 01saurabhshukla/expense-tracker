import { z } from 'zod';
import { LAYOUTS, pickFields } from './columns.js';
import { parseDate, parseAmountPaise, parseDirection, MAX_AMOUNT_PAISE } from './values.js';
import { ParseError } from './errors.js';

const MAX_DESCRIPTION_LENGTH = 500;

// The final guard. Every transaction this module produces must match this
// shape. A row with bad *data* becomes a row error long before this point;
// failing here means a bug in this file, so it throws instead of being
// reported as a row problem.
const transactionSchema = z.strictObject({
  line: z.number().int().positive(),
  date: z.iso.date(),
  valueDate: z.iso.date().nullable(),
  description: z.string().min(1).max(MAX_DESCRIPTION_LENGTH),
  reference: z.string().min(1).nullable(),
  direction: z.enum(['debit', 'credit']),
  amountPaise: z.number().int().positive().max(MAX_AMOUNT_PAISE),
  balancePaise: z.number().int().nullable(),
});

// Stage "validating", part 2: one data row → one of
//   { kind: 'transaction', transaction }
//   { kind: 'skip' }                         blank rows, footers, notes
//   { kind: 'error', error: { line, code, message } }
export function normalizeRow({ line, cells }, header) {
  const rowError = (code, message) => ({ kind: 'error', error: { line, code, message } });

  if (cells.every((cell) => cell.trim() === '')) return { kind: 'skip' };

  const fields = pickFields(cells, header.columns);
  const date = parseDate(fields.date);
  const amountCells =
    header.layout === LAYOUTS.SPLIT ? [fields.debit, fields.credit] : [fields.amount];
  const hasAnyAmount = amountCells.some((cell) => (cell ?? '').trim() !== '');

  // Text where the date belongs and no amounts at all: a footer or a note
  // ("STATEMENT SUMMARY :-", "Legends Used in Account Statement").
  if (date.error && !hasAnyAmount) return { kind: 'skip' };

  if (cells.length < header.width) {
    return rowError('MISSING_COLUMNS', `has ${cells.length} columns, expected ${header.width}`);
  }
  // Extra *filled-in* cells mean the columns may be shifted, so we can't trust
  // which number is the amount. (Empty trailing cells are harmless.)
  if (cells.slice(header.width).some((cell) => cell.trim() !== '')) {
    return rowError('UNEXPECTED_EXTRA_COLUMNS', `has ${cells.length} columns, expected ${header.width}`);
  }

  if (date.error) return rowError(date.error.code, date.error.message);

  const amount = readAmount(fields, header.layout);
  if (amount.error) return rowError(amount.error.code, amount.error.message);

  const description = fields.description.trim().replace(/\s+/g, ' ').slice(0, MAX_DESCRIPTION_LENGTH);
  if (description === '') return rowError('MISSING_DESCRIPTION', 'has no description');

  const balance = readBalance(fields);
  if (balance.error) return rowError(balance.error.code, balance.error.message);

  const valueDate = fields.valueDate === undefined ? { value: null } : parseDate(fields.valueDate);

  const transaction = transactionSchema.parse({
    line,
    date: date.value,
    // A broken value date is not worth rejecting the row for; it's optional.
    valueDate: valueDate.value ?? null,
    description,
    reference: cleanReference(fields.reference),
    direction: amount.value.direction,
    amountPaise: amount.value.amountPaise,
    balancePaise: balance.value,
  });
  return { kind: 'transaction', transaction };
}

// Runs every data row and collects the results. A file with no valid
// transaction at all is a failure of the whole file, not a partial import.
//
// `dataRows` can be an array or an async stream of rows (straight from a
// reader), so a big file is checked as it's read. `onProgress` is called
// every `progressEvery` rows with the running counts.
export async function normalizeRows(dataRows, header, { onProgress, progressEvery = 500 } = {}) {
  const transactions = [];
  const errors = [];
  let skipped = 0;
  let rowsRead = 0;

  for await (const row of dataRows) {
    const result = normalizeRow(row, header);
    if (result.kind === 'transaction') transactions.push(result.transaction);
    else if (result.kind === 'error') errors.push(result.error);
    else skipped++;

    rowsRead++;
    if (onProgress && rowsRead % progressEvery === 0) {
      await onProgress({ rowsRead, transactionsFound: transactions.length, rowErrors: errors.length });
    }
  }

  if (transactions.length === 0) {
    const message =
      errors.length === 0
        ? 'The statement has column headings but no transactions.'
        : `None of the ${errors.length} rows could be read.`;
    throw new ParseError('NO_VALID_TRANSACTIONS', message, { details: { errors: errors.slice(0, 20) } });
  }

  return { transactions, errors, skipped };
}

function readAmount(fields, layout) {
  if (layout === LAYOUTS.AMOUNT_WITH_FLAG) {
    const amount = parseAmountPaise(fields.amount);
    if (amount.error) return amount;
    if (!amount.value) return { error: { code: 'NO_AMOUNT', message: 'has no amount' } };

    const direction = parseDirection(fields.direction);
    if (direction.error) return direction;
    return { value: { direction: direction.value, amountPaise: amount.value } };
  }

  const debit = parseAmountPaise(fields.debit);
  if (debit.error) return debit;
  const credit = parseAmountPaise(fields.credit);
  if (credit.error) return credit;

  // ICICI writes 0.00 in the unused column, so zero counts as empty.
  const isDebit = debit.value > 0;
  const isCredit = credit.value > 0;

  if (isDebit && isCredit) {
    return { error: { code: 'BOTH_DEBIT_AND_CREDIT', message: 'has both a withdrawal and a deposit' } };
  }
  if (!isDebit && !isCredit) return { error: { code: 'NO_AMOUNT', message: 'has no amount' } };

  return isDebit
    ? { value: { direction: 'debit', amountPaise: debit.value } }
    : { value: { direction: 'credit', amountPaise: credit.value } };
}

// → { value: paise | null }. Overdrawn balances are marked with a Dr flag
// (Kotak's second Dr/Cr column) and stored as negative numbers.
function readBalance(fields) {
  if (fields.balance === undefined) return { value: null };

  const balance = parseAmountPaise(fields.balance);
  if (balance.error) {
    return { error: { code: 'INVALID_BALANCE', message: `balance: ${balance.error.message}` } };
  }
  if (balance.value === null) return { value: null };

  if (fields.balanceDirection !== undefined) {
    const side = parseDirection(fields.balanceDirection);
    if (side.error) return { error: { code: 'INVALID_BALANCE', message: `balance side: ${side.error.message}` } };
    if (side.value === 'debit') return { value: -balance.value };
  }
  return { value: balance.value };
}

// "-", "" and "0" mean "no reference" in various exports.
function cleanReference(raw) {
  const text = String(raw ?? '').trim();
  return text === '' || text === '-' || /^0+$/.test(text) ? null : text;
}
