-- Lash maps: per-client notes on how lash extensions are set, zone by zone (length, curl, thickness), with the same tenant isolation as
-- every other business table.
CREATE TABLE IF NOT EXISTS "lash_maps" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"business_id" text NOT NULL REFERENCES "public"."businesses"("id") ON DELETE cascade,
	"client_id" text NOT NULL REFERENCES "public"."clients"("id") ON DELETE cascade,
	"appointment_id" text REFERENCES "public"."appointments"("id") ON DELETE set null,
	"author_user_id" text REFERENCES "public"."user"("id") ON DELETE set null,
	"title" text NOT NULL,
	"zones" jsonb NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "lash_maps_client_idx" ON "lash_maps" USING btree ("business_id","client_id","created_at");--> statement-breakpoint
ALTER TABLE "lash_maps" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "lash_maps" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON "lash_maps";--> statement-breakpoint
CREATE POLICY tenant_isolation ON "lash_maps" FOR ALL USING (business_id = app_current_business_id()) WITH CHECK (business_id = app_current_business_id());
