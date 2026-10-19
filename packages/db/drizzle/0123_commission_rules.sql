-- Commission rules on the business (REVIEW-PAYROLL-2026-10-19.md §6 item 4), all defaulting to today's behaviour: who absorbs a ticket
-- discount (provider / house / split), the share of no-show and late-cancellation fees credited to the appointment's provider (0 = none),
-- and what a package-covered service pays commission on (the list price, or the package's per-session price).
ALTER TABLE "businesses" ADD COLUMN IF NOT EXISTS "discount_absorb" text NOT NULL DEFAULT 'provider';--> statement-breakpoint
ALTER TABLE "businesses" ADD COLUMN IF NOT EXISTS "fee_share_bps" integer NOT NULL DEFAULT 0;--> statement-breakpoint
ALTER TABLE "businesses" ADD COLUMN IF NOT EXISTS "package_redemption_base" text NOT NULL DEFAULT 'list';
