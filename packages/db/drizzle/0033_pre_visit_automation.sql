ALTER TYPE "public"."automation_kind" ADD VALUE 'pre_visit';--> statement-breakpoint
ALTER TABLE "automations" ADD COLUMN "hours_before" integer DEFAULT 48 NOT NULL;