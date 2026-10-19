-- Package sessions pay commission on the package's per-session price by default (the owner's choice, 2026-10-19), not the service's
-- list price. The setting shipped hours earlier with 'list' and nobody has chosen yet, so businesses still on it move with the default.
ALTER TABLE "businesses" ALTER COLUMN "package_redemption_base" SET DEFAULT 'package_share';--> statement-breakpoint
UPDATE "businesses" SET "package_redemption_base" = 'package_share' WHERE "package_redemption_base" = 'list';
