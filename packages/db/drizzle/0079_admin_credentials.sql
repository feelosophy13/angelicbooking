CREATE TABLE "admin_credentials" (
	"id" text PRIMARY KEY DEFAULT 'admin' NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
-- Only the admin app touches this table: the tenant-facing role gets nothing, the admin role may read and write it.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'angelic_app') THEN
    REVOKE ALL ON admin_credentials FROM angelic_app;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'angelic_admin') THEN
    GRANT SELECT, INSERT, UPDATE ON admin_credentials TO angelic_admin;
  END IF;
END $$;
