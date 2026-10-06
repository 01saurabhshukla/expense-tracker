ALTER TABLE uploads DROP CONSTRAINT uploads_format_check;
ALTER TABLE uploads ADD CONSTRAINT uploads_format_check CHECK (format IN ('csv', 'xlsx'));
