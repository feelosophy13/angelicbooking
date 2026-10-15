-- Run ONCE as a superuser / database owner (after roles.sql):
--   psql -h localhost -d angelic_booking -f packages/db/sql/admin-role.sql
--
-- The platform admin app (apps/admin) connects as `angelic_admin`. It must see
-- every tenant, so it BYPASSES row-level security, which is why it is kept
-- READ-ONLY apart from pricing and its audit log (granted at the bottom), and its credentials live only in the admin service's
-- environment (never in apps/web). Give it write access table by table, in a
-- later migration, when an admin action needs it.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'angelic_admin') THEN
    BEGIN
      CREATE ROLE angelic_admin LOGIN PASSWORD 'angelic_admin_dev' NOSUPERUSER BYPASSRLS NOCREATEDB NOCREATEROLE;
    EXCEPTION WHEN insufficient_privilege THEN
      -- Managed Postgres (Render) will not let the database owner create a BYPASSRLS role. Without it the role is
      -- ordinary and sees tenant rows only through the explicit policies created at the bottom of this file.
      CREATE ROLE angelic_admin LOGIN PASSWORD 'angelic_admin_dev' NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
    END;
  END IF;
END $$;
DO $$ BEGIN EXECUTE format('GRANT CONNECT ON DATABASE %I TO angelic_admin', current_database()); END $$;
GRANT USAGE ON SCHEMA public TO angelic_admin;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO angelic_admin;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO angelic_admin;

-- The only tables the admin app may write (pricing and its own audit trail). Idempotent, and safe to
-- run before the migration that creates them (re-run this file after migrating).
DO $$ BEGIN
  IF to_regclass('public.platform_pricing') IS NOT NULL THEN
    GRANT INSERT, UPDATE ON platform_pricing TO angelic_admin;
    GRANT INSERT, UPDATE, DELETE ON business_pricing TO angelic_admin;
    GRANT INSERT ON admin_audit_log TO angelic_admin;
  END IF;
  IF to_regclass('public.admin_credentials') IS NOT NULL THEN
    GRANT SELECT, INSERT, UPDATE ON admin_credentials TO angelic_admin;
  END IF;
END $$;

-- The only business columns the admin app may change (suspend, comp, extend a trial). Re-run after migrating.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'businesses' AND column_name = 'suspended_at') THEN
    GRANT UPDATE (suspended_at, suspended_reason, comped, trial_ends_at, updated_at) ON businesses TO angelic_admin;
  END IF;
END $$;

-- Row-level security: a role that cannot bypass it needs a read policy on every tenant table (harmless for a BYPASSRLS
-- role). Re-run this file after any migration that adds a tenant table; until then the admin app simply sees none of
-- that table's rows. business_pricing is also written by the admin app, so it gets a full policy.
DO $$
DECLARE t text;
BEGIN
  FOR t IN SELECT c.relname FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace AND c.relkind = 'r' AND c.relrowsecurity LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = t AND policyname = 'admin_read') THEN
      EXECUTE format('CREATE POLICY admin_read ON %I FOR SELECT TO angelic_admin USING (true)', t);
    END IF;
  END LOOP;
  IF to_regclass('public.business_pricing') IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'business_pricing' AND policyname = 'admin_write') THEN
    CREATE POLICY admin_write ON business_pricing FOR ALL TO angelic_admin USING (true) WITH CHECK (true);
  END IF;
END $$;
