-- Remember which Stripe account took each payment, deposit and subscription, so refunds and cancellations go to that account even
-- after a location switches accounts, is deleted, or the business reconnects Stripe. Existing rows: the sale's (or visit's) location
-- account, else the business's main account, which is what took them under the old rules.
ALTER TABLE "payments" ADD COLUMN "stripe_account_id" text;--> statement-breakpoint
ALTER TABLE "appointments" ADD COLUMN "deposit_stripe_account_id" text;--> statement-breakpoint
ALTER TABLE "client_memberships" ADD COLUMN "stripe_account_id" text;--> statement-breakpoint
ALTER TABLE "membership_plans" ADD COLUMN "stripe_price_ids" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
UPDATE "payments" p SET "stripe_account_id" = coalesce(l."stripe_account_id", b."stripe_account_id")
  FROM "sales" s JOIN "businesses" b ON b."id" = s."business_id" LEFT JOIN "locations" l ON l."id" = s."location_id"
  WHERE p."sale_id" = s."id" AND p."stripe_payment_intent_id" IS NOT NULL AND p."stripe_account_id" IS NULL;--> statement-breakpoint
UPDATE "appointments" a SET "deposit_stripe_account_id" = coalesce(l."stripe_account_id", b."stripe_account_id")
  FROM "businesses" b LEFT JOIN "locations" l ON true
  WHERE b."id" = a."business_id" AND (l."id" = a."location_id" OR (a."location_id" IS NULL AND l."id" IS NULL)) AND a."deposit_payment_intent_id" IS NOT NULL AND a."deposit_stripe_account_id" IS NULL;--> statement-breakpoint
UPDATE "appointments" a SET "deposit_stripe_account_id" = b."stripe_account_id"
  FROM "businesses" b WHERE b."id" = a."business_id" AND a."deposit_payment_intent_id" IS NOT NULL AND a."deposit_stripe_account_id" IS NULL;--> statement-breakpoint
UPDATE "client_memberships" m SET "stripe_account_id" = coalesce(l."stripe_account_id", b."stripe_account_id")
  FROM "businesses" b LEFT JOIN "locations" l ON true
  WHERE b."id" = m."business_id" AND l."id" = m."location_id" AND m."stripe_subscription_id" IS NOT NULL AND m."stripe_account_id" IS NULL;--> statement-breakpoint
UPDATE "client_memberships" m SET "stripe_account_id" = b."stripe_account_id"
  FROM "businesses" b WHERE b."id" = m."business_id" AND m."stripe_subscription_id" IS NOT NULL AND m."stripe_account_id" IS NULL;
