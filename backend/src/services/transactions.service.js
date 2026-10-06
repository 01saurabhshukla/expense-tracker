import { AppError } from '../errors.js';
import { withTransaction } from '../db/transaction.js';
import {
  listTransactionsForUser,
  findTransactionForUser,
  setTransactionCategory,
  setMerchantCategory,
} from '../db/queries/transactions.js';
import { upsertOverride, listOverridesForUser, deleteOverrideForUser } from '../db/queries/categoryOverrides.js';
import { transactionIdSchema, ruleIdSchema } from '../schemas/transactions.js';

export async function listTransactions(userId, { sort, limit, offset, ...filters }) {
  // Ask for one extra row: if it comes back, there's another page.
  const rows = await listTransactionsForUser(userId, filters, { sort, limit: limit + 1, offset });
  return {
    transactions: rows.slice(0, limit),
    pagination: { limit, offset, hasMore: rows.length > limit },
  };
}

// A correction. With applyToMerchant (the default) it's also remembered:
//   1. the merchant gets a rule in category_overrides (used by every future
//      upload — layer 1 of categorization, D25);
//   2. every existing transaction from that merchant is re-labelled.
// All in one database transaction, so the rule and the rows never disagree.
// A transaction without a merchant key can only be corrected on its own.
export async function updateCategory(userId, id, { category, applyToMerchant }) {
  if (!transactionIdSchema.safeParse(id).success) throw notFound();

  return withTransaction(async (db) => {
    // FOR UPDATE: two corrections of the same row wait for each other.
    const existing = await findTransactionForUser(db, userId, id, { forUpdate: true });
    if (!existing) throw notFound();

    if (applyToMerchant && existing.merchantKey) {
      const rule = await upsertOverride(db, userId, existing.merchantKey, category);
      const updatedCount = await setMerchantCategory(db, userId, existing.merchantKey, category);
      const transaction = await findTransactionForUser(db, userId, id);
      return { transaction, rule, updatedCount };
    }

    const transaction = await setTransactionCategory(db, userId, id, category);
    return { transaction, rule: null, updatedCount: 1 };
  });
}

export async function listRules(userId) {
  return { rules: await listOverridesForUser(userId) };
}

// Removes the rule only: transactions keep the category they have now (they
// still show categorySource "user"); future uploads go back to the rules.
export async function deleteRule(userId, id) {
  const deleted = ruleIdSchema.safeParse(id).success && (await deleteOverrideForUser(userId, id));
  if (!deleted) throw new AppError(404, 'RULE_NOT_FOUND', 'Rule not found');
}

// "Doesn't exist", "not a valid id" and "someone else's" all get the same
// 404, so nobody can probe which ids exist.
function notFound() {
  return new AppError(404, 'TRANSACTION_NOT_FOUND', 'Transaction not found');
}

