-- When each sale line was added, so a tip added to an old ticket is paid in the period it was added (existing lines: when their sale closed).
ALTER TABLE "sale_lines" ADD COLUMN IF NOT EXISTS "created_at" timestamp with time zone;--> statement-breakpoint
UPDATE "sale_lines" sl SET "created_at" = coalesce(s."closed_at", s."created_at") FROM "sales" s WHERE s."id" = sl."sale_id" AND sl."created_at" IS NULL;--> statement-breakpoint
UPDATE "sale_lines" SET "created_at" = now() WHERE "created_at" IS NULL;--> statement-breakpoint
ALTER TABLE "sale_lines" ALTER COLUMN "created_at" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "sale_lines" ALTER COLUMN "created_at" SET NOT NULL;--> statement-breakpoint
-- How overtime is counted when a payroll run has it on: "weekly" (federal: over 40 h a workweek) or "daily" (California: over 8 h a day,
-- double over 12, and the seventh day in a row).
ALTER TABLE "businesses" ADD COLUMN IF NOT EXISTS "overtime_rule" text NOT NULL DEFAULT 'weekly';
