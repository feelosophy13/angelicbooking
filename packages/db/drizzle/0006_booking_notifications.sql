CREATE EXTENSION IF NOT EXISTS pgcrypto;--> statement-breakpoint
CREATE TYPE "public"."notification_channel" AS ENUM('email', 'sms');--> statement-breakpoint
CREATE TYPE "public"."notification_status" AS ENUM('queued', 'sent', 'failed', 'skipped', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."waitlist_status" AS ENUM('open', 'booked', 'closed');--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"business_id" text NOT NULL,
	"client_id" text,
	"appointment_id" text,
	"channel" "notification_channel" NOT NULL,
	"template" text NOT NULL,
	"recipient" text NOT NULL,
	"subject" text,
	"body" text NOT NULL,
	"scheduled_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sent_at" timestamp with time zone,
	"status" "notification_status" DEFAULT 'queued' NOT NULL,
	"provider_id" text,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "waitlist" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"business_id" text NOT NULL,
	"client_id" text,
	"service_id" text,
	"staff_id" text,
	"date" date NOT NULL,
	"notes" text,
	"status" "waitlist_status" DEFAULT 'open' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "appointments" ADD COLUMN "manage_token" text DEFAULT encode(gen_random_bytes(18), 'hex') NOT NULL;--> statement-breakpoint
ALTER TABLE "businesses" ADD COLUMN "online_booking_enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "businesses" ADD COLUMN "min_notice_min" integer DEFAULT 120 NOT NULL;--> statement-breakpoint
ALTER TABLE "businesses" ADD COLUMN "max_advance_days" integer DEFAULT 60 NOT NULL;--> statement-breakpoint
ALTER TABLE "businesses" ADD COLUMN "cancel_window_hours" integer DEFAULT 24 NOT NULL;--> statement-breakpoint
ALTER TABLE "businesses" ADD COLUMN "require_card_online" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "businesses" ADD COLUMN "no_show_fee_cents" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "businesses" ADD COLUMN "booking_policy" text;--> statement-breakpoint
ALTER TABLE "businesses" ADD COLUMN "reminder_hours" integer DEFAULT 24 NOT NULL;--> statement-breakpoint
ALTER TABLE "businesses" ADD COLUMN "address_line" text;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_appointment_id_appointments_id_fk" FOREIGN KEY ("appointment_id") REFERENCES "public"."appointments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "waitlist" ADD CONSTRAINT "waitlist_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "waitlist" ADD CONSTRAINT "waitlist_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "waitlist" ADD CONSTRAINT "waitlist_service_id_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."services"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "waitlist" ADD CONSTRAINT "waitlist_staff_id_staff_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."staff"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "notifications_due_idx" ON "notifications" USING btree ("status","scheduled_at");--> statement-breakpoint
CREATE INDEX "notifications_appointment_idx" ON "notifications" USING btree ("appointment_id");--> statement-breakpoint
CREATE INDEX "notifications_business_idx" ON "notifications" USING btree ("business_id","created_at");--> statement-breakpoint
CREATE INDEX "waitlist_business_date_idx" ON "waitlist" USING btree ("business_id","status","date");--> statement-breakpoint
CREATE UNIQUE INDEX "appointments_manage_token_uq" ON "appointments" USING btree ("manage_token");