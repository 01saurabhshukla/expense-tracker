-- A role for the running app with only what it needs (D38). The app used to
-- connect as `postgres`, which can drop tables, change roles and bypasses
-- row-level security.
--
-- Created here WITHOUT a password and NOLOGIN: no secret in the repository.
-- `npm run db:app-role` sets a random password and allows login.
-- Migrations keep running as postgres (MIGRATION_DATABASE_URL).
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'expense_app') THEN
    CREATE ROLE expense_app NOLOGIN;
  END IF;
END
$$;

GRANT USAGE ON SCHEMA public TO expense_app;

-- Rows only: read, add, change, delete. No DDL, no TRUNCATE, no other schemas.
GRANT SELECT, INSERT, UPDATE, DELETE
  ON users, refresh_tokens, uploads, stored_files, transactions, category_overrides
  TO expense_app;
-- The category list is fixed (D25): read-only.
GRANT SELECT ON categories TO expense_app;
-- schema_migrations: no access at all.

-- Row-level security is on for every table and blocks everyone without a
-- policy (that's what keeps Supabase's public REST API out). Let the app
-- role through; anon/authenticated stay blocked. Users are kept apart by
-- the app's own `WHERE user_id = …` on every query (D17).
CREATE POLICY expense_app_all ON users              FOR ALL    TO expense_app USING (true) WITH CHECK (true);
CREATE POLICY expense_app_all ON refresh_tokens     FOR ALL    TO expense_app USING (true) WITH CHECK (true);
CREATE POLICY expense_app_all ON uploads            FOR ALL    TO expense_app USING (true) WITH CHECK (true);
CREATE POLICY expense_app_all ON stored_files       FOR ALL    TO expense_app USING (true) WITH CHECK (true);
CREATE POLICY expense_app_all ON transactions       FOR ALL    TO expense_app USING (true) WITH CHECK (true);
CREATE POLICY expense_app_all ON category_overrides FOR ALL    TO expense_app USING (true) WITH CHECK (true);
CREATE POLICY expense_app_read ON categories        FOR SELECT TO expense_app USING (true);
