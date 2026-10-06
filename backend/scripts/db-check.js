import pg from 'pg';

const client = new pg.Client({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

try {
  await client.connect();
  const result = await client.query('SELECT 1 AS ok, version()');
  console.log('Connected to Postgres');
  console.log(result.rows[0]);
} catch (err) {
  console.error('Connection failed:', err.message);
  process.exitCode = 1;
} finally {
  await client.end();
}
