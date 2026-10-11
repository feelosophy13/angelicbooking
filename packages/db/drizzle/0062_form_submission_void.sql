ALTER TABLE "form_submissions" ADD COLUMN "voided_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "form_submissions" ADD COLUMN "voided_by_user_id" text;--> statement-breakpoint
ALTER TABLE "form_submissions" ADD COLUMN "void_reason" text;