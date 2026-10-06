import { pool } from '../pool.js';

export async function createUser({ email, name, passwordHash }) {
  const { rows } = await pool.query(
    `INSERT INTO users (email, name, password_hash)
     VALUES ($1, $2, $3)
     RETURNING id, email, name, created_at AS "createdAt"`,
    [email, name, passwordHash],
  );
  return rows[0];
}

// Includes the password hash: only for checking a login, never for responses.
export async function findUserByEmail(email) {
  const { rows } = await pool.query(
    `SELECT id, email, name, created_at AS "createdAt", password_hash AS "passwordHash"
     FROM users WHERE email = $1`,
    [email],
  );
  return rows[0] ?? null;
}

export async function findUserById(id) {
  const { rows } = await pool.query(
    `SELECT id, email, name, created_at AS "createdAt"
     FROM users WHERE id = $1`,
    [id],
  );
  return rows[0] ?? null;
}
