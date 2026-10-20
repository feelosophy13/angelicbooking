-- Tip choices (Settings → Checkout & tips): the percentages offered on the client-facing tip screen and the staff tip form.
ALTER TABLE "businesses" ADD COLUMN IF NOT EXISTS "tip_percents" integer[] NOT NULL DEFAULT '{18,20,25}';--> statement-breakpoint
-- "Card (own terminal)": a card charged on the salon's own card machine (any processor) and recorded here by hand.
ALTER TYPE "public"."payment_method" ADD VALUE IF NOT EXISTS 'external_card';
