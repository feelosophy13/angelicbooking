CREATE TYPE "public"."messaging_number_status" AS ENUM('unverified', 'pending_review', 'in_review', 'verified', 'rejected', 'released');--> statement-breakpoint
CREATE TABLE "messaging_numbers" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"business_id" text NOT NULL,
	"phone_number" text NOT NULL,
	"provider_sid" text NOT NULL,
	"number_type" text DEFAULT 'toll_free' NOT NULL,
	"status" "messaging_number_status" DEFAULT 'unverified' NOT NULL,
	"verification_sid" text,
	"verification_submitted_at" timestamp with time zone,
	"verified_at" timestamp with time zone,
	"rejection_reason" text,
	"rejection_details" jsonb,
	"edit_allowed" boolean DEFAULT false NOT NULL,
	"verification" jsonb,
	"monthly_fee_cents" integer DEFAULT 0 NOT NULL,
	"billing_starts_at" timestamp with time zone,
	"purchased_at" timestamp with time zone DEFAULT now() NOT NULL,
	"released_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "messaging_numbers_provider_sid_unique" UNIQUE("provider_sid")
);
--> statement-breakpoint
ALTER TABLE "messaging_numbers" ADD CONSTRAINT "messaging_numbers_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "messaging_numbers_active_idx" ON "messaging_numbers" USING btree ("business_id") WHERE released_at is null;--> statement-breakpoint
CREATE INDEX "messaging_numbers_status_idx" ON "messaging_numbers" USING btree ("status");--> statement-breakpoint
ALTER TABLE messaging_numbers ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE messaging_numbers FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON messaging_numbers FOR ALL USING (business_id = app_current_business_id()) WITH CHECK (business_id = app_current_business_id());
--> statement-breakpoint
-- The reminder cron polls pending verifications across tenants (withJobs); writes stay tenant-scoped.
CREATE POLICY jobs_read ON messaging_numbers FOR SELECT USING (current_setting('app.jobs', true) = 'on');
