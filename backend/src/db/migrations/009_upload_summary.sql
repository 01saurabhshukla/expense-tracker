-- The statement summary (totals, by category, by month, running-balance
-- check), written when the upload completes. NULL until then, and for
-- uploads completed before this migration (they are not reprocessed: their
-- transactions are already correct, only the summary is missing).
ALTER TABLE uploads ADD COLUMN summary jsonb;

-- New stage between categorizing and saving.
ALTER TABLE uploads DROP CONSTRAINT uploads_stage_check;
ALTER TABLE uploads ADD CONSTRAINT uploads_stage_check
  CHECK (stage IN ('queued', 'reading', 'validating', 'categorizing', 'summarizing',
                   'saving', 'completed', 'failed'));
