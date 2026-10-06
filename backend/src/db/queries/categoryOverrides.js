import { pool } from '../pool.js';

// All of one user's corrections as a Map: merchantKey → category.
export async function findOverridesForUser(userId) {
  const { rows } = await pool.query(
    'SELECT merchant_key, category FROM category_overrides WHERE user_id = $1',
    [userId],
  );
  return new Map(rows.map((row) => [row.merchant_key, row.category]));
}

const PUBLIC_COLUMNS = `id, merchant_key AS "merchantKey", category,
  created_at AS "createdAt", updated_at AS "updatedAt"`;

// "Always put this merchant in this category" — one per merchant per user;
// a newer correction for the same merchant replaces the older one.
export async function upsertOverride(db, userId, merchantKey, category) {
  const { rows } = await db.query(
    `INSERT INTO category_overrides (user_id, merchant_key, category)
     VALUES ($1, $2, $3)
     ON CONFLICT (user_id, merchant_key)
     DO UPDATE SET category = EXCLUDED.category, updated_at = now()
     RETURNING ${PUBLIC_COLUMNS}`,
    [userId, merchantKey, category],
  );
  return rows[0];
}

export async function listOverridesForUser(userId) {
  const { rows } = await pool.query(
    `SELECT ${PUBLIC_COLUMNS} FROM category_overrides WHERE user_id = $1 ORDER BY merchant_key`,
    [userId],
  );
  return rows;
}

// Returns true if the rule existed (and belonged to this user).
export async function deleteOverrideForUser(userId, id) {
  const { rowCount } = await pool.query('DELETE FROM category_overrides WHERE id = $1 AND user_id = $2', [id, userId]);
  return rowCount === 1;
}
