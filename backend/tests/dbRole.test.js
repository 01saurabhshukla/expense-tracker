// The app's database role (D38): exactly the rights it needs, nothing more.
// Reads Postgres's own catalog, so it works whichever role runs the tests.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';

const { pool } = await import('../src/db/pool.js');
after(() => pool.end());

const ROLE = 'expense_app';
const APP_TABLES = ['users', 'refresh_tokens', 'uploads', 'stored_files', 'transactions', 'category_overrides'];

const can = async (table, privilege) =>
  (await pool.query('SELECT has_table_privilege($1, $2, $3) AS ok', [ROLE, `public.${table}`, privilege])).rows[0].ok;

test('the role has no special powers', async () => {
  const { rows } = await pool.query(
    'SELECT rolsuper, rolbypassrls, rolcreaterole, rolcreatedb FROM pg_roles WHERE rolname = $1',
    [ROLE],
  );
  assert.deepEqual(rows[0], { rolsuper: false, rolbypassrls: false, rolcreaterole: false, rolcreatedb: false });
});

test('it can read and write rows in the app tables', async () => {
  for (const table of APP_TABLES) {
    for (const privilege of ['SELECT', 'INSERT', 'UPDATE', 'DELETE']) {
      assert.equal(await can(table, privilege), true, `${privilege} on ${table}`);
    }
  }
});

test('it can only read the category list, and not touch migrations at all', async () => {
  assert.equal(await can('categories', 'SELECT'), true);
  for (const privilege of ['INSERT', 'UPDATE', 'DELETE']) assert.equal(await can('categories', privilege), false, privilege);
  assert.equal(await can('schema_migrations', 'SELECT'), false);
  assert.equal(await can('users', 'TRUNCATE'), false);
});

test('every table except schema_migrations lets the role through row-level security', async () => {
  // Guards future migrations: a new table without a policy for the app role
  // would look empty to the app, so this test fails until one is added.
  const { rows } = await pool.query(
    `SELECT c.relname AS table,
            c.relrowsecurity AS rls,
            EXISTS (SELECT 1 FROM pg_policies p
                    WHERE p.schemaname = 'public' AND p.tablename = c.relname AND $1 = ANY (p.roles)) AS has_policy
     FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relname <> 'schema_migrations'
     ORDER BY 1`,
    [ROLE],
  );
  assert.ok(rows.length >= 7);
  for (const row of rows) {
    assert.equal(row.rls, true, `${row.table}: RLS must stay on (it keeps Supabase's public API out)`);
    assert.equal(row.has_policy, true, `${row.table}: needs a policy for ${ROLE} (see migration 011)`);
  }
});

test('the role cannot create tables in the schema', async () => {
  const { rows } = await pool.query("SELECT has_schema_privilege($1, 'public', 'CREATE') AS ok", [ROLE]);
  assert.equal(rows[0].ok, false);
});
