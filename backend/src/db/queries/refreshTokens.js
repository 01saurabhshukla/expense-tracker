// Each function takes `db` as its first argument: either the pool (for a
// standalone query) or a transaction client from withTransaction().

export async function insertRefreshToken(db, { userId, familyId, tokenHash, expiresAt }) {
  await db.query(
    `INSERT INTO refresh_tokens (user_id, family_id, token_hash, expires_at)
     VALUES ($1, $2, $3, $4)`,
    [userId, familyId, tokenHash, expiresAt],
  );
}

// FOR UPDATE locks the row until the transaction ends, so two requests
// refreshing the same token at the same moment are handled one after the other.
export async function findRefreshTokenForUpdate(db, tokenHash) {
  const { rows } = await db.query(
    `SELECT id, user_id AS "userId", family_id AS "familyId",
            expires_at AS "expiresAt", revoked_at AS "revokedAt"
     FROM refresh_tokens WHERE token_hash = $1
     FOR UPDATE`,
    [tokenHash],
  );
  return rows[0] ?? null;
}

export async function revokeRefreshToken(db, id) {
  await db.query('UPDATE refresh_tokens SET revoked_at = now() WHERE id = $1', [id]);
}

export async function revokeFamily(db, familyId) {
  await db.query(
    'UPDATE refresh_tokens SET revoked_at = now() WHERE family_id = $1 AND revoked_at IS NULL',
    [familyId],
  );
}
