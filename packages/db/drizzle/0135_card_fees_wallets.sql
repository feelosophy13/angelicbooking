-- Card surcharge / convenience fee (Settings → Checkout & tips), opt-in per business, and the domains each Stripe account has registered
-- for Apple Pay and Google Pay.
ALTER TABLE "businesses" ADD COLUMN IF NOT EXISTS "card_fee_type" text DEFAULT 'off' NOT NULL;--> statement-breakpoint
ALTER TABLE "businesses" ADD COLUMN IF NOT EXISTS "card_fee_bps" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "businesses" ADD COLUMN IF NOT EXISTS "card_fee_cents" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "businesses" ADD COLUMN IF NOT EXISTS "card_fee_desk" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "businesses" ADD COLUMN IF NOT EXISTS "card_fee_online" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "businesses" ADD COLUMN IF NOT EXISTS "card_fee_store" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "businesses" ADD COLUMN IF NOT EXISTS "card_fee_debit_exempt" boolean DEFAULT true NOT NULL;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "businesses" ADD CONSTRAINT "businesses_card_fee_ck" CHECK ("card_fee_type" IN ('off', 'surcharge', 'convenience') AND "card_fee_bps" BETWEEN 0 AND 300 AND "card_fee_cents" BETWEEN 0 AND 10000);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
-- The fee is its own ticket line, tied to the card payment that carried it.
ALTER TYPE "sale_line_kind" ADD VALUE IF NOT EXISTS 'card_fee';--> statement-breakpoint
ALTER TABLE "sale_lines" ADD COLUMN IF NOT EXISTS "payment_id" text;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "sale_lines_payment_uq" ON "sale_lines" ("payment_id") WHERE "payment_id" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "sales" ADD COLUMN IF NOT EXISTS "card_fee_cents" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
-- The part of a payment that is the card fee (included in amount_cents), and how much of it has gone back with refunds.
ALTER TABLE "payments" ADD COLUMN IF NOT EXISTS "surcharge_cents" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN IF NOT EXISTS "surcharge_refunded_cents" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "refunds" ADD COLUMN IF NOT EXISTS "surcharge_cents" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "store_credit_ledger" ADD COLUMN IF NOT EXISTS "surcharge_cents" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
-- A deposit paid online with a card fee on top: deposit_cents stays the deposit, this is the fee charged with it.
ALTER TABLE "appointments" ADD COLUMN IF NOT EXISTS "deposit_surcharge_cents" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
-- Apple Pay / Google Pay: a domain registered with Stripe (payment method domains) on one account. Platform data, no RLS.
CREATE TABLE IF NOT EXISTS "stripe_payment_domains" (
  "account_id" text NOT NULL,
  "domain" text NOT NULL,
  "stripe_domain_id" text,
  "apple_pay_status" text,
  "google_pay_status" text,
  "error" text,
  "livemode" boolean DEFAULT false NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "stripe_payment_domains_pk" PRIMARY KEY ("account_id", "domain", "livemode")
);
