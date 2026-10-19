-- Pay schedule on the business (REVIEW-PAYROLL-2026-10-19.md §6 item 1): how the calendar is cut into pay periods, so the Payroll page
-- opens on the current period and steps Previous / Next instead of two typed dates, finalized periods can't overlap, and a salary
-- "per pay period" is prorated when a run is not exactly one period. Null = not set: today's behaviour (every two weeks from the most
-- recent finalized period, salary flat per run). The overtime workweek follows week_start from now on (it was always Monday).
ALTER TABLE "businesses" ADD COLUMN IF NOT EXISTS "pay_frequency" text;--> statement-breakpoint
ALTER TABLE "businesses" ADD COLUMN IF NOT EXISTS "pay_anchor_date" date;
