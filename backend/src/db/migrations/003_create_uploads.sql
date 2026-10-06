CREATE TABLE uploads (
  id                uuid        PRIMARY KEY,
  user_id           uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  original_filename text        NOT NULL CHECK (char_length(original_filename) BETWEEN 1 AND 255),
  size_bytes        integer     NOT NULL CHECK (size_bytes > 0),
  sha256            text        NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  format            text        NOT NULL CHECK (format IN ('csv')),
  status            text        NOT NULL DEFAULT 'received'
                                CHECK (status IN ('received', 'processing', 'processed', 'failed')),
  created_at        timestamptz NOT NULL DEFAULT now(),
  -- The same user uploading byte-for-byte the same file twice is a duplicate.
  -- Different users may upload identical files.
  UNIQUE (user_id, sha256)
);

-- "List my uploads, newest first" is the main query.
CREATE INDEX uploads_user_id_created_at_idx ON uploads (user_id, created_at DESC);

ALTER TABLE uploads ENABLE ROW LEVEL SECURITY;
