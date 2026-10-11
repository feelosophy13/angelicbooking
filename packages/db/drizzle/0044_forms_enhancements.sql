ALTER TABLE "form_submissions" ADD COLUMN "signature_file_id" text;--> statement-breakpoint
ALTER TABLE "form_submissions" ADD COLUMN "assisted_by_user_id" text;--> statement-breakpoint
ALTER TABLE "forms" ADD COLUMN "location_ids" text[] DEFAULT '{}'::text[] NOT NULL;