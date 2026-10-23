-- Fill My Books: personal invitations to open slots, and the settings for sending them (by hand or once a day).
ALTER TABLE "businesses" ADD COLUMN IF NOT EXISTS "fill_auto_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "businesses" ADD COLUMN IF NOT EXISTS "fill_auto_hour" smallint DEFAULT 10 NOT NULL;--> statement-breakpoint
ALTER TABLE "businesses" ADD COLUMN IF NOT EXISTS "fill_days_ahead" smallint DEFAULT 3 NOT NULL;--> statement-breakpoint
ALTER TABLE "businesses" ADD COLUMN IF NOT EXISTS "fill_max_per_slot" smallint DEFAULT 3 NOT NULL;--> statement-breakpoint
ALTER TABLE "businesses" ADD COLUMN IF NOT EXISTS "fill_max_per_day" smallint DEFAULT 20 NOT NULL;--> statement-breakpoint
ALTER TABLE "businesses" ADD COLUMN IF NOT EXISTS "fill_message" text;--> statement-breakpoint
ALTER TABLE "businesses" ADD COLUMN IF NOT EXISTS "fill_auto_ran_on" text;--> statement-breakpoint
-- AI assistant: a monthly spending limit per business and the booking-page chat switch (off by default).
ALTER TABLE "businesses" ADD COLUMN IF NOT EXISTS "ai_monthly_budget_cents" integer DEFAULT 500 NOT NULL;--> statement-breakpoint
ALTER TABLE "businesses" ADD COLUMN IF NOT EXISTS "ai_chatbot_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "fill_invites" (
  "id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
  "business_id" text NOT NULL REFERENCES "businesses"("id") ON DELETE CASCADE,
  "client_id" text NOT NULL REFERENCES "clients"("id") ON DELETE CASCADE,
  "staff_id" text REFERENCES "staff"("id") ON DELETE SET NULL,
  "service_id" text REFERENCES "services"("id") ON DELETE SET NULL,
  "location_id" text REFERENCES "locations"("id") ON DELETE SET NULL,
  "slot_start" timestamp with time zone NOT NULL,
  "reason" text NOT NULL,
  "channel" "notification_channel" NOT NULL,
  "notification_id" text,
  "sent_by_user_id" text,
  "booked_appointment_id" text REFERENCES "appointments"("id") ON DELETE SET NULL,
  "booked_exact_slot" boolean DEFAULT false NOT NULL,
  "booked_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "fill_invites_slot_idx" ON "fill_invites" ("business_id", "staff_id", "slot_start");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "fill_invites_client_idx" ON "fill_invites" ("business_id", "client_id", "created_at");--> statement-breakpoint
ALTER TABLE "fill_invites" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "fill_invites" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON "fill_invites";--> statement-breakpoint
CREATE POLICY tenant_isolation ON "fill_invites" FOR ALL USING (business_id = app_current_business_id()) WITH CHECK (business_id = app_current_business_id());--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ai_usage" (
  "id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
  "business_id" text NOT NULL REFERENCES "businesses"("id") ON DELETE CASCADE,
  "feature" text NOT NULL,
  "model" text NOT NULL,
  "input_tokens" integer DEFAULT 0 NOT NULL,
  "output_tokens" integer DEFAULT 0 NOT NULL,
  "cache_read_tokens" integer DEFAULT 0 NOT NULL,
  "cache_write_tokens" integer DEFAULT 0 NOT NULL,
  "cost_micros" integer DEFAULT 0 NOT NULL,
  "user_id" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ai_usage_business_idx" ON "ai_usage" ("business_id", "created_at");--> statement-breakpoint
ALTER TABLE "ai_usage" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "ai_usage" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON "ai_usage";--> statement-breakpoint
CREATE POLICY tenant_isolation ON "ai_usage" FOR ALL USING (business_id = app_current_business_id()) WITH CHECK (business_id = app_current_business_id());
