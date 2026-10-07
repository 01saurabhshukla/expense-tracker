import { z } from 'zod';
import { CATEGORY_KEYS } from '../categorize/categories.js';

// Filters shared by the transaction list, the dashboard and the exports, so
// "what I see" and "what I export" always mean the same rows.
// Strict: a misspelt parameter (?categroy=…) is an error, not silently ignored.
export const filterShape = {
  from: z.iso.date().optional(), // inclusive, YYYY-MM-DD
  to: z.iso.date().optional(), // inclusive
  category: z.enum(CATEGORY_KEYS).optional(),
  direction: z.enum(['debit', 'credit']).optional(),
  uploadId: z.uuid().optional(),
  q: z.string().trim().min(1).max(100).optional(), // text in the description
  merchant: z.string().min(1).max(200).optional(), // exact merchant key (top merchants → their rows)
};

export const SORTS = ['date_desc', 'date_asc', 'amount_desc', 'amount_asc'];

export function fromBeforeTo(query) {
  return !query.from || !query.to || query.from <= query.to;
}
const fromBeforeToIssue = { message: '"from" must be on or before "to"', path: ['from'] };

export const transactionFiltersSchema = z.strictObject(filterShape).refine(fromBeforeTo, fromBeforeToIssue);

export const listTransactionsQuerySchema = z
  .strictObject({
    ...filterShape,
    sort: z.enum(SORTS).default('date_desc'),
    limit: z.coerce.number().int().min(1).max(200).default(50),
    offset: z.coerce.number().int().min(0).max(100_000).default(0),
  })
  .refine(fromBeforeTo, fromBeforeToIssue);

// PATCH /transactions/:id — a correction.
// applyToMerchant (default true): remember it for this merchant, re-label
// every transaction from the same merchant, and use it for future uploads.
export const updateTransactionSchema = z.strictObject({
  category: z.enum(CATEGORY_KEYS),
  applyToMerchant: z.boolean().default(true),
});

export const transactionIdSchema = z.uuid();
export const ruleIdSchema = z.uuid();

// GET /dashboard — the same filters, plus how to group over time.
export const GRANULARITIES = ['day', 'week', 'month'];
export const dashboardQuerySchema = z
  .strictObject({ ...filterShape, granularity: z.enum(GRANULARITIES).default('month') })
  .refine(fromBeforeTo, fromBeforeToIssue);
