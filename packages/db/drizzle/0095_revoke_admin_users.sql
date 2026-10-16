-- 0091 created admin_users without the revoke that 0074/0079 gave the other admin tables, so the tenant-facing
-- role inherited full access through default privileges. Only the admin app may touch it.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'angelic_app') THEN
    REVOKE ALL ON admin_users FROM angelic_app;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'angelic_admin') THEN
    GRANT SELECT, INSERT, UPDATE ON admin_users TO angelic_admin;
  END IF;
END $$;
