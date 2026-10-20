-- Helcim online payments: a HelcimPay.js checkout opened on the booking page or the online store, kept until its result is verified
-- (the Helcim twin of a Stripe PaymentIntent / SetupIntent id). The secret proves the browser's result; it is encrypted.
CREATE TABLE IF NOT EXISTS "helcim_checkouts" (
  "id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
  "business_id" text NOT NULL REFERENCES "businesses"("id") ON DELETE CASCADE,
  "purpose" text NOT NULL,
  "meta" jsonb NOT NULL,
  "amount_cents" integer NOT NULL,
  "checkout_token" text NOT NULL,
  "secret_token" text NOT NULL,
  "status" text DEFAULT 'open' NOT NULL,
  "transaction_id" text,
  "card_label" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "paid_at" timestamp with time zone,
  "used_at" timestamp with time zone
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "helcim_checkouts_sweep_idx" ON "helcim_checkouts" ("status", "paid_at");--> statement-breakpoint
ALTER TABLE "helcim_checkouts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "helcim_checkouts" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "helcim_checkouts" FOR ALL USING (business_id = app_current_business_id()) WITH CHECK (business_id = app_current_business_id());--> statement-breakpoint
CREATE POLICY jobs_read ON "helcim_checkouts" FOR SELECT USING (current_setting('app.jobs', true) = 'on');--> statement-breakpoint
-- Which processor took an online deposit, and its transaction there (Stripe keeps using deposit_payment_intent_id).
ALTER TABLE "appointments" ADD COLUMN IF NOT EXISTS "deposit_provider" text DEFAULT 'stripe' NOT NULL;--> statement-breakpoint
ALTER TABLE "appointments" ADD COLUMN IF NOT EXISTS "deposit_provider_payment_id" text;
