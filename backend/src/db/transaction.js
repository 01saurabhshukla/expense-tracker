import { pool } from './pool.js';

// Runs `fn` inside BEGIN/COMMIT on one dedicated connection. If `fn` throws,
// everything it did is rolled back. Whatever `fn` returns is passed through.
export async function withTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
