import { readFileSync } from 'node:fs';

// TLS settings for every database connection (the app's pool and scripts).
//
// With DATABASE_CA_CERT (the path to Supabase's CA certificate, downloaded
// from the dashboard): the server must present a certificate signed by that
// CA for the host we asked for, otherwise the connection is refused. That
// stops anyone in the middle from posing as the database (D37).
//
// Without it (local development only; production requires it, see env.js):
// still encrypted, but the server's identity is not checked.
//
// `mode` "disable" turns TLS off entirely: only for a throwaway local
// database (CI's Postgres container has no TLS). Production refuses it.
export function databaseSsl(caCertPath, mode = process.env.DATABASE_SSL ?? 'require') {
  if (mode === 'disable') return false;
  if (!caCertPath) return { rejectUnauthorized: false };
  return { ca: readFileSync(caCertPath, 'utf8'), rejectUnauthorized: true };
}
