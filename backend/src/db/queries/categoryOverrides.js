import { pool } from '../pool.js';

// All of one user's corrections as a Map: merchantKey → category.
export async function findOverridesForUser(userId) {
  const { rows } = await pool.query(
    'SELECT merchant_key, category FROM category_overrides WHERE user_id = $1',
    [userId],
  );
  return new Map(rows.map((row) => [row.merchant_key, row.category]));
}
