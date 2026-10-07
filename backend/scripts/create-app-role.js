// Turns on the app's limited database role (D38) and switches .env to it.
//
//   npm run migrate        (once: migration 011 creates the role, no password)
//   npm run db:app-role    (this script)
//
// What it does:
//   1. connects as the admin role (MIGRATION_DATABASE_URL, or DATABASE_URL
//      if that is still the admin);
//   2. gives `expense_app` a new random password and allows it to log in;
//   3. connects AS expense_app to prove it works (through the same pooler);
//   4. only then rewrites backend/.env:
//        DATABASE_URL           → expense_app (what the app uses)
//        MIGRATION_DATABASE_URL → the admin URL (only for migrations)
//      after copying the old file to .env.backup-<time>.
//
// Running it again rotates the password. The password is never printed.
import { randomBytes } from 'node:crypto';
import { copyFile, readFile, writeFile } from 'node:fs/promises';
import pg from 'pg';
import { databaseSsl } from '../src/db/ssl.js';

const ROLE = 'expense_app';
const ENV_FILE = new URL('../.env', import.meta.url);
const ssl = databaseSsl(process.env.DATABASE_CA_CERT);

const adminUrl = process.env.MIGRATION_DATABASE_URL ?? process.env.DATABASE_URL;
if (!adminUrl || new URL(adminUrl).username.startsWith(`${ROLE}`)) {
  fail('No admin connection: set MIGRATION_DATABASE_URL to the postgres connection string.');
}

// Supabase's pooler names users "<role>.<project-ref>"; keep the suffix.
const adminUser = new URL(adminUrl).username; // e.g. "postgres.iundq…"
const dot = adminUser.indexOf('.');
const suffix = dot === -1 ? '' : adminUser.slice(dot); // ".iundq…" or "" (direct host)
const password = randomBytes(32).toString('base64url');
const appUrl = new URL(adminUrl);
appUrl.username = `${ROLE}${suffix}`;
appUrl.password = password;

// 1–2: set the password, as admin.
const adminClient = new pg.Client({ connectionString: adminUrl, ssl });
await adminClient.connect();
try {
  const { rows } = await adminClient.query('SELECT 1 FROM pg_roles WHERE rolname = $1', [ROLE]);
  if (rows.length === 0) fail(`Role ${ROLE} doesn't exist yet: run \`npm run migrate\` first.`);
  // ALTER ROLE can't take a bind parameter; escapeLiteral quotes it safely.
  await adminClient.query(`ALTER ROLE ${ROLE} WITH LOGIN PASSWORD ${adminClient.escapeLiteral(password)}`);
} finally {
  await adminClient.end();
}
console.log(`Password set for ${ROLE} (not shown).`);

// 3: prove the new login works before touching .env.
const appClient = new pg.Client({ connectionString: appUrl.toString(), ssl, connectionTimeoutMillis: 15_000 });
try {
  await appClient.connect();
  const { rows } = await appClient.query('SELECT current_user AS who, (SELECT count(*) FROM categories)::int AS categories');
  console.log(`Logged in as ${rows[0].who}; it can read ${rows[0].categories} categories.`);
} catch (err) {
  fail(`Logging in as ${ROLE} failed (${err.message}). .env was NOT changed.`);
} finally {
  await appClient.end().catch(() => {});
}

// 4: rewrite .env, keeping a backup.
const backup = new URL(`../.env.backup-${Date.now()}`, import.meta.url);
await copyFile(ENV_FILE, backup);
let text = await readFile(ENV_FILE, 'utf8');
text = setLine(text, 'MIGRATION_DATABASE_URL', adminUrl);
text = setLine(text, 'DATABASE_URL', appUrl.toString());
await writeFile(ENV_FILE, text, { mode: 0o600 });
console.log('.env updated: DATABASE_URL now uses expense_app; the admin URL moved to MIGRATION_DATABASE_URL.');
console.log(`Previous .env saved as ${backup.pathname.split('/').pop()} (git-ignored; delete it once all is well).`);

function setLine(content, key, value) {
  const line = `${key}=${value}`;
  const pattern = new RegExp(`^${key}=.*$`, 'm');
  return pattern.test(content) ? content.replace(pattern, () => line) : `${content.replace(/\n?$/, '\n')}${line}\n`;
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
