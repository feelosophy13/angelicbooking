-- Run ONCE as a superuser / database owner (after roles.sql):
--   psql -h localhost -d angelic_booking -f packages/db/sql/admin-role.sql
--
-- The platform admin app (apps/admin) connects as `angelic_admin`. It must see
-- every tenant, so it BYPASSES row-level security, which is why it is kept
-- strictly READ-ONLY and its credentials live only in the admin service's
-- environment (never in apps/web). Give it write access table by table, in a
-- later migration, when an admin action needs it.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'angelic_admin') THEN
    CREATE ROLE angelic_admin LOGIN PASSWORD 'angelic_admin_dev' NOSUPERUSER BYPASSRLS NOCREATEDB NOCREATEROLE;
  END IF;
END $$;
GRANT CONNECT ON DATABASE angelic_booking TO angelic_admin;
GRANT USAGE ON SCHEMA public TO angelic_admin;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO angelic_admin;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO angelic_admin;
