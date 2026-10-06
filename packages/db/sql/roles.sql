-- Run ONCE as a superuser / database owner:
--   psql -h localhost -d angelic_booking -f packages/db/sql/roles.sql
--
-- The application connects as `angelic_app`, a plain role that cannot bypass
-- Row-Level Security. Migrations run as the owning (admin) role via
-- DATABASE_ADMIN_URL.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'angelic_app') THEN
    CREATE ROLE angelic_app LOGIN PASSWORD 'angelic_app_dev' NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
  END IF;
END $$;
GRANT CONNECT ON DATABASE angelic_booking TO angelic_app;
GRANT USAGE ON SCHEMA public TO angelic_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO angelic_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO angelic_app;
-- Tables created by future migrations (run as the current admin role) are granted automatically.
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO angelic_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO angelic_app;
