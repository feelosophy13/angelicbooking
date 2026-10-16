-- Marketing consent separate from appointment messages. Nobody has given marketing-text consent yet (the booking checkbox only covers
-- confirmations and reminders), so it starts off for everyone; marketing email keeps whatever the client chose for email.
ALTER TABLE "clients" ADD COLUMN "sms_marketing_opt_in" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "sms_marketing_consent_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "sms_marketing_consent_source" text;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "email_marketing_opt_in" boolean DEFAULT true NOT NULL;--> statement-breakpoint
UPDATE "clients" SET "email_marketing_opt_in" = "email_opt_in";--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "marketing" boolean DEFAULT false NOT NULL;--> statement-breakpoint
UPDATE "notifications" SET "marketing" = true WHERE "campaign_id" IS NOT NULL AND "status" IN ('queued','sending');--> statement-breakpoint
CREATE TABLE "sms_suppressions" (
	"business_id" text NOT NULL,
	"phone_tail" text NOT NULL,
	"source" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sms_suppressions_business_id_phone_tail_pk" PRIMARY KEY("business_id","phone_tail")
);--> statement-breakpoint
ALTER TABLE "sms_suppressions" ADD CONSTRAINT "sms_suppressions_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
-- Everyone who already replied STOP (their client row says no texts) starts on the list.
INSERT INTO "sms_suppressions" ("business_id", "phone_tail", "source")
  SELECT DISTINCT "business_id", right(regexp_replace("phone", '\D', '', 'g'), 10), 'stop' FROM "clients"
  WHERE "sms_opt_in" = false AND "phone" IS NOT NULL AND length(regexp_replace("phone", '\D', '', 'g')) >= 10
  ON CONFLICT DO NOTHING;--> statement-breakpoint
ALTER TABLE "sms_suppressions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "sms_suppressions" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON "sms_suppressions";--> statement-breakpoint
CREATE POLICY tenant_isolation ON "sms_suppressions" FOR ALL USING (business_id = app_current_business_id()) WITH CHECK (business_id = app_current_business_id());
