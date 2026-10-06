-- Transactions are derived from the stored files, which are never deleted
-- (D16), so the simplest correct way to add fingerprints to existing rows is
-- to rebuild them: drop the rows and send finished uploads back to the
-- queue. The worker's sweep reprocesses them with fingerprints.
DELETE FROM transactions;
UPDATE uploads SET stage = 'queued', progress = '{}'::jsonb, finished_at = NULL, updated_at = now()
WHERE stage = 'completed';

-- One row per real-world transaction per user (fingerprint: D24).
ALTER TABLE transactions ADD COLUMN fingerprint text NOT NULL CHECK (fingerprint ~ '^[0-9a-f]{64}$');
ALTER TABLE transactions ADD CONSTRAINT transactions_user_id_fingerprint_key UNIQUE (user_id, fingerprint);

-- A file whose processing failed can be uploaded again: the duplicate-file
-- rule now ignores failed uploads. (A partial unique index: uniqueness only
-- among rows matching the WHERE.)
ALTER TABLE uploads DROP CONSTRAINT uploads_user_id_sha256_key;
CREATE UNIQUE INDEX uploads_user_id_sha256_not_failed_key
  ON uploads (user_id, sha256) WHERE stage <> 'failed';
