-- "Mark as paid" on a finalized pay period (REVIEW-PAYROLL-2026-10-19.md §6 item 2): the day the checks went out and a check number or
-- batch reference, for the record. While a period is marked paid it can't be re-finalized (unmark it first); both are in the activity log.
ALTER TABLE "payroll_runs" ADD COLUMN IF NOT EXISTS "paid_on" date;--> statement-breakpoint
ALTER TABLE "payroll_runs" ADD COLUMN IF NOT EXISTS "payment_ref" text;--> statement-breakpoint
ALTER TABLE "payroll_runs" ADD COLUMN IF NOT EXISTS "paid_by_user_id" text;--> statement-breakpoint
ALTER TABLE "payroll_runs" ADD COLUMN IF NOT EXISTS "paid_at" timestamp with time zone;
