// The approved category list (D25). Must match the `categories` table seeded
// by migration 008; tests/categorize/categories.test.js checks they agree.
export const CATEGORIES = [
  { key: 'food_dining', name: 'Food & Dining', kind: 'expense' },
  { key: 'groceries', name: 'Groceries', kind: 'expense' },
  { key: 'transport', name: 'Transport', kind: 'expense' },
  { key: 'fuel', name: 'Fuel', kind: 'expense' },
  { key: 'travel', name: 'Travel', kind: 'expense' },
  { key: 'shopping', name: 'Shopping', kind: 'expense' },
  { key: 'utilities', name: 'Bills & Utilities', kind: 'expense' },
  { key: 'entertainment', name: 'Entertainment & Subscriptions', kind: 'expense' },
  { key: 'health', name: 'Health', kind: 'expense' },
  { key: 'rent', name: 'Rent & Housing', kind: 'expense' },
  { key: 'investments', name: 'Investments', kind: 'expense' },
  { key: 'cash', name: 'Cash Withdrawal', kind: 'expense' },
  { key: 'transfers_out', name: 'Transfers Out', kind: 'expense' },
  { key: 'salary', name: 'Salary', kind: 'income' },
  { key: 'interest', name: 'Interest', kind: 'income' },
  { key: 'transfers_in', name: 'Money Received', kind: 'income' },
  { key: 'uncategorized', name: 'Uncategorized', kind: 'other' },
];

export const CATEGORY_KEYS = CATEGORIES.map((c) => c.key);
export const UNCATEGORIZED = 'uncategorized';
