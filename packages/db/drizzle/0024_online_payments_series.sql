CREATE TYPE "public"."deposit_status" AS ENUM('none', 'paid', 'applied', 'refunded');--> statement-breakpoint
CREATE TABLE "appointment_series" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"business_id" text NOT NULL,
	"client_id" text,
	"service_id" text,
	"staff_id" text,
	"interval_weeks" smallint NOT NULL,
	"first_start_at" timestamp with time zone NOT NULL,
	"occurrences" smallint NOT NULL,
	"notes" text,
	"ended_at" timestamp with time zone,
	"created_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "appointments" ADD COLUMN "series_id" text;--> statement-breakpoint
ALTER TABLE "appointments" ADD COLUMN "deposit_cents" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "appointments" ADD COLUMN "deposit_status" "deposit_status" DEFAULT 'none' NOT NULL;--> statement-breakpoint
ALTER TABLE "appointments" ADD COLUMN "deposit_payment_intent_id" text;--> statement-breakpoint
ALTER TABLE "appointments" ADD COLUMN "deposit_card_label" text;--> statement-breakpoint
ALTER TABLE "appointments" ADD COLUMN "card_setup_intent_id" text;--> statement-breakpoint
ALTER TABLE "staff" ADD COLUMN "calendar_token" text DEFAULT encode(gen_random_bytes(18), 'hex') NOT NULL;--> statement-breakpoint
ALTER TABLE "appointment_series" ADD CONSTRAINT "appointment_series_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointment_series" ADD CONSTRAINT "appointment_series_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointment_series" ADD CONSTRAINT "appointment_series_service_id_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."services"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointment_series" ADD CONSTRAINT "appointment_series_staff_id_staff_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."staff"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointment_series" ADD CONSTRAINT "appointment_series_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "appointment_series_business_idx" ON "appointment_series" USING btree ("business_id","client_id");--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_series_id_appointment_series_id_fk" FOREIGN KEY ("series_id") REFERENCES "public"."appointment_series"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "appointments_deposit_pi_uq" ON "appointments" USING btree ("deposit_payment_intent_id");--> statement-breakpoint
CREATE INDEX "appointments_series_idx" ON "appointments" USING btree ("series_id");--> statement-breakpoint
CREATE UNIQUE INDEX "staff_calendar_token_uq" ON "staff" USING btree ("calendar_token");