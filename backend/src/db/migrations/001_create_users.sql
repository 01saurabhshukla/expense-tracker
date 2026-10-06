CREATE TABLE users (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  email         text        NOT NULL UNIQUE CHECK (email = lower(email)),
  name          text        NOT NULL CHECK (char_length(name) BETWEEN 1 AND 100),
  password_hash text        NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- Supabase exposes the public schema through its auto-generated REST API.
-- RLS with no policies blocks that API completely; our backend connects as
-- the table owner, which bypasses RLS, so it is unaffected.
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
