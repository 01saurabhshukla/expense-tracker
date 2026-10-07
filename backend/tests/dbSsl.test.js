// Database TLS: with a CA certificate the server's identity is checked.
// Connects to the real Supabase database.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { databaseSsl } from '../src/db/ssl.js';

const WRONG_CA = fileURLToPath(new URL('./fixtures/certs/wrong-ca.crt', import.meta.url));

async function connectWith(ssl) {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl, connectionTimeoutMillis: 10_000 });
  try {
    await client.connect();
    await client.query('SELECT 1');
    return 'connected';
  } finally {
    await client.end().catch(() => {});
  }
}

test('without a CA file: encrypted, server not verified (local dev only)', () => {
  assert.deepEqual(databaseSsl(undefined, 'require'), { rejectUnauthorized: false });
});

test('DATABASE_SSL=disable turns TLS off (throwaway CI database only)', () => {
  assert.equal(databaseSsl('/any/ca.crt', 'disable'), false);
});

test('with a CA file: the certificate is loaded and verification is on', () => {
  const ssl = databaseSsl(WRONG_CA, 'require');
  assert.equal(ssl.rejectUnauthorized, true);
  assert.match(ssl.ca, /BEGIN CERTIFICATE/);
});

test('a server not signed by the given CA is refused (verification really happens)', { skip: process.env.DATABASE_SSL === 'disable' && 'database has no TLS (CI container)' }, async () => {
  // Our real Supabase server, but we claim to trust only a made-up CA: an
  // impostor would look exactly like this, so the connection must fail.
  await assert.rejects(connectWith(databaseSsl(WRONG_CA, 'require')), (err) => {
    assert.match(err.message, /certificate/i);
    return true;
  });
});

test('with the real Supabase CA (if configured), the connection is verified and works', { skip: !process.env.DATABASE_CA_CERT && 'DATABASE_CA_CERT not set' }, async () => {
  assert.equal(await connectWith(databaseSsl(process.env.DATABASE_CA_CERT)), 'connected');
});
