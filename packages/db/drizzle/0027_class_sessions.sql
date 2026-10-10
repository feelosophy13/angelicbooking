CREATE TYPE "public"."class_session_status" AS ENUM('scheduled', 'cancelled');--> statement-breakpoint
CREATE TABLE "class_sessions" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"business_id" text NOT NULL,
	"service_id" text NOT NULL,
	"staff_id" text NOT NULL,
	"location_id" text,
	"start_at" timestamp with time zone NOT NULL,
	"end_at" timestamp with time zone NOT NULL,
	"capacity" smallint NOT NULL,
	"price_cents" integer NOT NULL,
	"notes" text,
	"status" "class_session_status" DEFAULT 'scheduled' NOT NULL,
	"created_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "class_sessions_range_ck" CHECK ("class_sessions"."start_at" < "class_sessions"."end_at")
);
--> statement-breakpoint
ALTER TABLE "appointment_items" ADD COLUMN "class_session_id" text;--> statement-breakpoint
ALTER TABLE "services" ADD COLUMN "capacity" smallint DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "class_sessions" ADD CONSTRAINT "class_sessions_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "class_sessions" ADD CONSTRAINT "class_sessions_service_id_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."services"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "class_sessions" ADD CONSTRAINT "class_sessions_staff_id_staff_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."staff"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "class_sessions" ADD CONSTRAINT "class_sessions_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "class_sessions" ADD CONSTRAINT "class_sessions_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "class_sessions_business_time_idx" ON "class_sessions" USING btree ("business_id","start_at");--> statement-breakpoint
CREATE INDEX "class_sessions_staff_idx" ON "class_sessions" USING btree ("business_id","staff_id","start_at");--> statement-breakpoint
ALTER TABLE "appointment_items" ADD CONSTRAINT "appointment_items_class_session_id_class_sessions_id_fk" FOREIGN KEY ("class_session_id") REFERENCES "public"."class_sessions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "appointment_items_class_session_idx" ON "appointment_items" USING btree ("class_session_id");--> statement-breakpoint
ALTER TABLE "services" ADD CONSTRAINT "services_capacity_ck" CHECK ("services"."capacity" between 1 and 500);