import { readdir, readFile } from 'node:fs/promises';
import pg from 'pg';
import { databaseSsl } from '../src/db/ssl.js';

// Migrations change the schema, which the app's own limited role can't do
// (D38). They run as the admin role: MIGRATION_DATABASE_URL if set,
// otherwise DATABASE_URL (before the app role exists).
const pool = new pg.Pool({
  connectionString: process.env.MIGRATION_DATABASE_URL ?? process.env.DATABASE_URL,
  ssl: databaseSsl(process.env.DATABASE_CA_CERT),
  max: 1,
});

const MIGRATIONS_DIR = new URL('../src/db/migrations/', import.meta.url);

const client = await pool.connect();

try {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name       text        PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    );
    ALTER TABLE schema_migrations ENABLE ROW LEVEL SECURITY;
  `);

  const { rows } = await client.query('SELECT name FROM schema_migrations');
  const applied = new Set(rows.map((row) => row.name));

  // Files are named 001_..., 002_..., so sorting by name gives the run order.
  const files = (await readdir(MIGRATIONS_DIR))
    .filter((file) => file.endsWith('.sql'))
    .sort();

  for (const file of files) {
    if (applied.has(file)) {
      console.log(`skip     ${file} (already applied)`);
      continue;
    }

    const sql = await readFile(new URL(file, MIGRATIONS_DIR), 'utf8');

    await client.query('BEGIN');
    try {
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
      await client.query('COMMIT');
      console.log(`applied  ${file}`);
    } catch (err) {
      await client.query('ROLLBACK');
      throw new Error(`Migration ${file} failed and was rolled back: ${err.message}`);
    }
  }
} catch (err) {
  console.error(err.message);
  process.exitCode = 1;
} finally {
  client.release();
  await pool.end();
}
