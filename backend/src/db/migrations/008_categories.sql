-- The approved category list (D25). Keys are fixed and used by code, the
-- LLM layer and exports; display names can change. Must match
-- src/categorize/categories.js (a test checks this).
CREATE TABLE categories (
  key        text    PRIMARY KEY CHECK (key ~ '^[a-z_]+$'),
  name       text    NOT NULL,
  kind       text    NOT NULL CHECK (kind IN ('expense', 'income', 'other')),
  sort_order integer NOT NULL
);

INSERT INTO categories (key, name, kind, sort_order) VALUES
  ('food_dining',   'Food & Dining',                 'expense', 10),
  ('groceries',     'Groceries',                     'expense', 20),
  ('transport',     'Transport',                     'expense', 30),
  ('fuel',          'Fuel',                          'expense', 40),
  ('travel',        'Travel',                        'expense', 50),
  ('shopping',      'Shopping',                      'expense', 60),
  ('utilities',     'Bills & Utilities',             'expense', 70),
  ('entertainment', 'Entertainment & Subscriptions', 'expense', 80),
  ('health',        'Health',                        'expense', 90),
  ('rent',          'Rent & Housing',                'expense', 100),
  ('investments',   'Investments',                   'expense', 110),
  ('cash',          'Cash Withdrawal',               'expense', 120),
  ('transfers_out', 'Transfers Out',                 'expense', 130),
  ('salary',        'Salary',                        'income',  140),
  ('interest',      'Interest',                      'income',  150),
  ('transfers_in',  'Money Received',                'income',  160),
  ('uncategorized', 'Uncategorized',                 'other',   999);

ALTER TABLE categories ENABLE ROW LEVEL SECURITY;

-- Rebuild derived data so existing rows get categories (files are kept, D16).
DELETE FROM transactions;
UPDATE uploads SET stage = 'queued', progress = '{}'::jsonb, finished_at = NULL, updated_at = now()
WHERE stage = 'completed';

ALTER TABLE transactions
  ADD COLUMN category        text NOT NULL DEFAULT 'uncategorized' REFERENCES categories (key),
  -- Which layer decided: the user's correction, a rule, the LLM, or nothing.
  ADD COLUMN category_source text NOT NULL DEFAULT 'none'
                             CHECK (category_source IN ('user', 'rule', 'llm', 'none')),
  -- What a correction is remembered by (UPI handle or cleaned name).
  ADD COLUMN merchant_key    text CHECK (char_length(merchant_key) BETWEEN 1 AND 200);

CREATE INDEX transactions_user_id_merchant_key_idx ON transactions (user_id, merchant_key);

-- "Always put this merchant in this category", per user.
CREATE TABLE category_overrides (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  merchant_key text        NOT NULL CHECK (char_length(merchant_key) BETWEEN 1 AND 200),
  category     text        NOT NULL REFERENCES categories (key),
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, merchant_key)
);

ALTER TABLE category_overrides ENABLE ROW LEVEL SECURITY;

-- New stage between validating and saving.
ALTER TABLE uploads DROP CONSTRAINT uploads_stage_check;
ALTER TABLE uploads ADD CONSTRAINT uploads_stage_check
  CHECK (stage IN ('queued', 'reading', 'validating', 'categorizing', 'saving', 'completed', 'failed'));
