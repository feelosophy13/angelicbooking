-- Helcim as a second card processor (HELCIM-PLAN-2026-10-20.md). A business picks its processor; Stripe stays the default.
ALTER TABLE "businesses" ADD COLUMN IF NOT EXISTS "payment_provider" text NOT NULL DEFAULT 'stripe';--> statement-breakpoint
-- The merchant's Helcim API token and webhook verifier token, encrypted with APP_ENCRYPTION_KEY (lib/secrets.ts).
ALTER TABLE "businesses" ADD COLUMN IF NOT EXISTS "helcim_api_token" text;--> statement-breakpoint
ALTER TABLE "businesses" ADD COLUMN IF NOT EXISTS "helcim_webhook_verifier" text;--> statement-breakpoint
ALTER TABLE "businesses" ADD COLUMN IF NOT EXISTS "helcim_connected_at" timestamp with time zone;--> statement-breakpoint
-- Which processor took a payment, its transaction id there, the invoice number a card terminal was sent, and (encrypted) the
-- HelcimPay.js secret that proves a browser checkout's result, kept only while the payment is pending.
ALTER TABLE "payments" ADD COLUMN IF NOT EXISTS "provider" text NOT NULL DEFAULT 'stripe';--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN IF NOT EXISTS "provider_payment_id" text;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN IF NOT EXISTS "provider_invoice" text;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN IF NOT EXISTS "provider_session" text;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "payments_provider_payment_uq" ON "payments" ("provider", "provider_payment_id") WHERE "provider_payment_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "payments_provider_invoice_idx" ON "payments" ("provider_invoice") WHERE "provider_invoice" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "refunds" ADD COLUMN IF NOT EXISTS "provider_refund_id" text;--> statement-breakpoint
-- Helcim Smart Terminals paired with the app: the four-character device code shown on the terminal, per location.
CREATE TABLE IF NOT EXISTS "helcim_devices" (
  "id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
  "business_id" text NOT NULL REFERENCES "businesses"("id") ON DELETE CASCADE,
  "location_id" text REFERENCES "locations"("id") ON DELETE SET NULL,
  "code" text NOT NULL,
  "name" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "helcim_devices_code_uq" ON "helcim_devices" ("business_id", "code");--> statement-breakpoint
ALTER TABLE "helcim_devices" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "helcim_devices" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "helcim_devices" FOR ALL USING (business_id = app_current_business_id()) WITH CHECK (business_id = app_current_business_id());--> statement-breakpoint
-- A client's Helcim customer (saved cards live there), mirroring client_stripe_customers.
CREATE TABLE IF NOT EXISTS "client_helcim_customers" (
  "business_id" text NOT NULL REFERENCES "businesses"("id") ON DELETE CASCADE,
  "client_id" text PRIMARY KEY NOT NULL REFERENCES "clients"("id") ON DELETE CASCADE,
  "helcim_customer_id" integer NOT NULL,
  "customer_code" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "client_helcim_customers_business_idx" ON "client_helcim_customers" ("business_id");--> statement-breakpoint
ALTER TABLE "client_helcim_customers" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "client_helcim_customers" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "client_helcim_customers" FOR ALL USING (business_id = app_current_business_id()) WITH CHECK (business_id = app_current_business_id());
