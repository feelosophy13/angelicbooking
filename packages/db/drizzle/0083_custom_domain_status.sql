ALTER TABLE "businesses" ADD COLUMN "custom_domain_status" text DEFAULT 'none' NOT NULL;--> statement-breakpoint
ALTER TABLE "businesses" ADD COLUMN "custom_domain_render_id" text;--> statement-breakpoint
ALTER TABLE "businesses" ADD COLUMN "custom_domain_error" text;--> statement-breakpoint
ALTER TABLE "businesses" ADD COLUMN "custom_domain_checked_at" timestamp with time zone;