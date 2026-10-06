-- `status` becomes the more detailed `stage` the frontend polls.
ALTER TABLE uploads DROP CONSTRAINT uploads_status_check;
ALTER TABLE uploads RENAME COLUMN status TO stage;
UPDATE uploads SET stage = 'queued' WHERE stage IN ('received', 'processing');
UPDATE uploads SET stage = 'completed' WHERE stage = 'processed';
ALTER TABLE uploads ALTER COLUMN stage SET DEFAULT 'queued';
ALTER TABLE uploads ADD CONSTRAINT uploads_stage_check
  CHECK (stage IN ('queued', 'reading', 'validating', 'saving', 'completed', 'failed'));

ALTER TABLE uploads
  ADD COLUMN progress      jsonb       NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN error_code    text,
  ADD COLUMN error_message text,
  -- First 100 row errors: [{ line, code, message }]. The total is in progress.
  ADD COLUMN row_errors    jsonb       NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN attempts      integer     NOT NULL DEFAULT 0,
  ADD COLUMN started_at    timestamptz,
  ADD COLUMN finished_at   timestamptz,
  ADD COLUMN updated_at    timestamptz NOT NULL DEFAULT now();

CREATE TABLE transactions (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  upload_id     uuid        NOT NULL,
  line          integer     NOT NULL CHECK (line > 0),
  date          date        NOT NULL,
  value_date    date,
  description   text        NOT NULL CHECK (char_length(description) BETWEEN 1 AND 500),
  reference     text,
  direction     text        NOT NULL CHECK (direction IN ('debit', 'credit')),
  -- Whole paise. bigint: integer tops out at ~₹2 crore in paise.
  amount_paise  bigint      NOT NULL CHECK (amount_paise > 0),
  balance_paise bigint,
  created_at    timestamptz NOT NULL DEFAULT now(),
  -- A transaction can never claim a different owner than its upload.
  FOREIGN KEY (upload_id, user_id) REFERENCES uploads (id, user_id) ON DELETE CASCADE
);

-- Dashboard: "my transactions between these dates".
CREATE INDEX transactions_user_id_date_idx ON transactions (user_id, date);
-- Reprocessing: "delete this upload's previous attempt".
CREATE INDEX transactions_upload_id_idx ON transactions (upload_id);

ALTER TABLE transactions ENABLE ROW LEVEL SECURITY;
