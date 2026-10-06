-- Needed so stored_files can reference (id, user_id) together below.
ALTER TABLE uploads ADD CONSTRAINT uploads_id_user_id_key UNIQUE (id, user_id);

-- Where each accepted file physically lives, and who owns it.
-- Kept separate from `uploads` (what the user sent and its processing status)
-- so storage details can change later (e.g. S3, retention) without touching it.
CREATE TABLE stored_files (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  upload_id      uuid        NOT NULL UNIQUE,
  user_id        uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  storage_backend text       NOT NULL DEFAULT 'local' CHECK (storage_backend IN ('local')),
  -- Relative to UPLOAD_DIR (e.g. 'files/<upload id>'), so moving the storage
  -- folder or the server only means changing UPLOAD_DIR, not every row.
  storage_path   text        NOT NULL UNIQUE
                             CHECK (storage_path !~ '^/' AND storage_path !~ '\.\.'),
  created_at     timestamptz NOT NULL DEFAULT now(),
  -- The pair must exist in uploads: a stored file can never claim a
  -- different owner than its upload.
  FOREIGN KEY (upload_id, user_id) REFERENCES uploads (id, user_id) ON DELETE CASCADE
);

CREATE INDEX stored_files_user_id_idx ON stored_files (user_id);

ALTER TABLE stored_files ENABLE ROW LEVEL SECURITY;
