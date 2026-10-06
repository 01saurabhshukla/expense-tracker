CREATE TABLE refresh_tokens (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- Every token created by rotating the same login shares one family_id,
  -- so a detected reuse can revoke the whole chain at once.
  family_id  uuid        NOT NULL,
  -- SHA-256 of the token. The raw token only ever exists in the user's cookie.
  token_hash text        NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX refresh_tokens_family_id_idx ON refresh_tokens (family_id);
CREATE INDEX refresh_tokens_user_id_idx ON refresh_tokens (user_id);

ALTER TABLE refresh_tokens ENABLE ROW LEVEL SECURITY;
