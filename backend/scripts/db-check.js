import pg from 'pg';
import { databaseSsl } from '../src/db/ssl.js';

const client = new pg.Client({
  connectionString: process.env.DATABASE_URL,
  ssl: databaseSsl(process.env.DATABASE_CA_CERT),
});

try {
  await client.connect();
  const result = await client.query('SELECT 1 AS ok, version()');
  console.log('Connected to Postgres');
  console.log(process.env.DATABASE_CA_CERT ? 'Server certificate: verified against DATABASE_CA_CERT' : 'Server certificate: NOT verified (set DATABASE_CA_CERT)');
  console.log(result.rows[0]);
} catch (err) {
  console.error('Connection failed:', err.message);
  process.exitCode = 1;
} finally {
  await client.end();
}
