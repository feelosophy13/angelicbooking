ALTER TABLE "staff" ADD COLUMN "rotation_weeks" smallint DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "staff" ADD COLUMN "rotation_anchor" date;--> statement-breakpoint
ALTER TABLE "staff_schedules" ADD COLUMN "week_index" smallint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "staff_schedules" ADD CONSTRAINT "staff_schedules_week_ck" CHECK ("staff_schedules"."week_index" between 0 and 3);