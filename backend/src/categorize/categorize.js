import { categorizeByRules } from './rules.js';
import { merchantKey } from './merchant.js';
import { UNCATEGORIZED } from './categories.js';

// Stage "categorizing": gives every transaction a category, the layer that
// decided it, and its merchant key. First match wins:
//   1. the user's own correction for this merchant  → source 'user'
//   2–4. rules (type, merchant, transfer)            → source 'rule'
//   5. nothing                                       → 'uncategorized', source 'none'
//
// `overrides` is a Map of merchantKey → category for this user.
// Returns new objects; also returns counts per source for progress reporting.
export function categorizeTransactions(transactions, overrides = new Map()) {
  const counts = { user: 0, rule: 0, none: 0 };

  const categorized = transactions.map((transaction) => {
    const key = merchantKey(transaction.description);
    const result = decide(transaction, key, overrides);
    counts[result.categorySource]++;
    return { ...transaction, merchantKey: key, ...result };
  });

  return { transactions: categorized, counts };
}

function decide(transaction, key, overrides) {
  if (key && overrides.has(key)) {
    return { category: overrides.get(key), categorySource: 'user' };
  }
  const byRule = categorizeByRules(transaction);
  if (byRule) return { category: byRule.category, categorySource: 'rule' };
  return { category: UNCATEGORIZED, categorySource: 'none' };
}
