ALTER TABLE "user" ADD COLUMN "onboarding_nudged_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "businesses" ADD COLUMN "terms_accepted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "businesses" ADD COLUMN "terms_version" text;--> statement-breakpoint
ALTER TABLE "businesses" ADD COLUMN "publish_requires_verified" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "business_pricing" ADD COLUMN "trial_email_cap" integer;--> statement-breakpoint
ALTER TABLE "platform_pricing" ADD COLUMN "trial_email_cap" integer;