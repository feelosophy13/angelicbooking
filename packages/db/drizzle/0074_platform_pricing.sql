CREATE TABLE "admin_audit_log" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"actor" text NOT NULL,
	"action" text NOT NULL,
	"business_id" text,
	"detail" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "business_pricing" (
	"business_id" text PRIMARY KEY NOT NULL,
	"base_cents" integer,
	"included_locations" integer,
	"per_location_cents" integer,
	"included_staff" integer,
	"per_staff_cents" integer,
	"number_cents" integer,
	"sms_included" integer,
	"sms_usage_cents" integer,
	"trial_days" integer,
	"note" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "platform_pricing" (
	"id" text PRIMARY KEY DEFAULT 'default' NOT NULL,
	"base_cents" integer,
	"included_locations" integer,
	"per_location_cents" integer,
	"included_staff" integer,
	"per_staff_cents" integer,
	"number_cents" integer,
	"sms_included" integer,
	"sms_usage_cents" integer,
	"trial_days" integer,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "business_pricing" ADD CONSTRAINT "business_pricing_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "admin_audit_log_at_idx" ON "admin_audit_log" USING btree ("at");--> statement-breakpoint
CREATE INDEX "admin_audit_log_business_idx" ON "admin_audit_log" USING btree ("business_id");
--> statement-breakpoint
-- business_pricing is per-tenant: a business may read its own row; only the admin app writes.
ALTER TABLE business_pricing ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE business_pricing FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_read ON business_pricing FOR SELECT USING (business_id = app_current_business_id());
--> statement-breakpoint
-- The tenant-facing role may read pricing but never change it, and never sees the admin audit log.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'angelic_app') THEN
    REVOKE INSERT, UPDATE, DELETE ON platform_pricing, business_pricing FROM angelic_app;
    REVOKE ALL ON admin_audit_log FROM angelic_app;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'angelic_admin') THEN
    GRANT INSERT, UPDATE ON platform_pricing TO angelic_admin;
    GRANT INSERT, UPDATE, DELETE ON business_pricing TO angelic_admin;
    GRANT INSERT ON admin_audit_log TO angelic_admin;
  END IF;
END $$;
