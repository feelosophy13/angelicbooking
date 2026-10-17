-- The platform admin role reads every table, but never secrets: password hashes and OAuth tokens (account), 2FA secrets (two_factor),
-- sign-in and reset codes (verification, client_login_codes), API key hashes (api_keys) and session tokens (session: only who and when).
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'angelic_admin') THEN
    REVOKE ALL ON "account", "two_factor", "verification", "client_login_codes", "api_keys" FROM angelic_admin;
    REVOKE ALL ON "session" FROM angelic_admin;
    GRANT SELECT ("id", "user_id", "created_at", "updated_at", "expires_at", "active_organization_id") ON "session" TO angelic_admin;
  END IF;
END $$;
