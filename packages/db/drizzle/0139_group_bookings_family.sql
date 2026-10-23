-- Group bookings: one online booking for the client and up to three guests. Each person gets their own appointment; the appointments are
-- tied together by group_id, which holds the lead (booker's) appointment id (the lead's own group_id is its id).
ALTER TABLE "appointments" ADD COLUMN IF NOT EXISTS "group_id" text REFERENCES "appointments"("id") ON DELETE SET NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "appointments_group_idx" ON "appointments" ("business_id", "group_id");--> statement-breakpoint
-- A group's deposit is one charge shared by its appointments (each holds its own share). The one-booking-per-deposit guard now covers
-- the lead appointments only: a guest's appointment carries the lead's PaymentIntent too.
DROP INDEX IF EXISTS "appointments_deposit_pi_uq";--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "appointments_deposit_pi_lead_uq" ON "appointments" ("deposit_payment_intent_id") WHERE "group_id" IS NULL OR "group_id" = "id";--> statement-breakpoint
-- Family and linked clients: one row per direction, so "Mia is Jen's child" is stored with "Jen is Mia's parent".
-- relation says what linked_client_id is to client_id.
CREATE TABLE IF NOT EXISTS "client_links" (
  "id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
  "business_id" text NOT NULL REFERENCES "businesses"("id") ON DELETE CASCADE,
  "client_id" text NOT NULL REFERENCES "clients"("id") ON DELETE CASCADE,
  "linked_client_id" text NOT NULL REFERENCES "clients"("id") ON DELETE CASCADE,
  "relation" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "client_links_not_self" CHECK ("client_id" <> "linked_client_id"),
  CONSTRAINT "client_links_relation_ck" CHECK ("relation" IN ('child', 'parent', 'partner', 'other'))
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "client_links_pair_uq" ON "client_links" ("client_id", "linked_client_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "client_links_business_idx" ON "client_links" ("business_id");--> statement-breakpoint
ALTER TABLE "client_links" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "client_links" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DO $$ BEGIN
  CREATE POLICY tenant_isolation ON "client_links" FOR ALL USING (business_id = app_current_business_id()) WITH CHECK (business_id = app_current_business_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
