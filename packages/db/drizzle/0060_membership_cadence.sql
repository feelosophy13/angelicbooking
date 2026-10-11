ALTER TYPE "public"."membership_status" ADD VALUE 'ended';--> statement-breakpoint
ALTER TABLE "client_memberships" ADD COLUMN "cycles_billed" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "client_memberships" ADD COLUMN "frozen_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "client_memberships" ADD COLUMN "frozen_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "membership_plans" ADD COLUMN "interval" text DEFAULT 'month' NOT NULL;--> statement-breakpoint
ALTER TABLE "membership_plans" ADD COLUMN "interval_count" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "membership_plans" ADD COLUMN "rollover_cap" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "membership_plans" ADD COLUMN "cycle_count" integer;