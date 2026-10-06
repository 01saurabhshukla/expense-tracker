-- Step 7i: the file is imported in ONE streaming pass, so validating,
-- categorizing and summarizing happen together, batch by batch. The stages
-- become: queued → reading → importing → saving → completed | failed,
-- with progress.percent showing how far through the file we are.
UPDATE uploads SET stage = 'queued', updated_at = now()
WHERE stage IN ('validating', 'categorizing', 'summarizing');

ALTER TABLE uploads DROP CONSTRAINT uploads_stage_check;
ALTER TABLE uploads ADD CONSTRAINT uploads_stage_check
  CHECK (stage IN ('queued', 'reading', 'importing', 'saving', 'completed', 'failed'));
