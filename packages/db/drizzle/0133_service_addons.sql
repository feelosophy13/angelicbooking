-- Add-ons: services the salon suggests with another one at online booking ("Add to your visit?"), up to a few per service, each with an
-- optional add-on price (fixed, or an amount off the stylist's own price) and an optional add-on time.
CREATE TABLE IF NOT EXISTS "service_addons" (
  "business_id" text NOT NULL REFERENCES "businesses"("id") ON DELETE CASCADE,
  "service_id" text NOT NULL REFERENCES "services"("id") ON DELETE CASCADE,
  "addon_service_id" text NOT NULL REFERENCES "services"("id") ON DELETE CASCADE,
  "price_cents" integer,
  "discount_cents" integer,
  "duration_min" smallint,
  "sort_order" smallint DEFAULT 0 NOT NULL,
  CONSTRAINT "service_addons_pk" PRIMARY KEY ("service_id", "addon_service_id"),
  CONSTRAINT "service_addons_not_self" CHECK ("service_id" <> "addon_service_id"),
  CONSTRAINT "service_addons_one_price" CHECK ("price_cents" IS NULL OR "discount_cents" IS NULL)
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "service_addons_business_idx" ON "service_addons" ("business_id");--> statement-breakpoint
ALTER TABLE "service_addons" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "service_addons" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DO $$ BEGIN
  CREATE POLICY tenant_isolation ON "service_addons" FOR ALL USING (business_id = app_current_business_id()) WITH CHECK (business_id = app_current_business_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
