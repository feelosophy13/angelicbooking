CREATE TABLE "visit_photos" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"business_id" text NOT NULL,
	"appointment_id" text NOT NULL,
	"client_id" text,
	"service_id" text,
	"staff_id" text,
	"phase" text NOT NULL,
	"file_id" text NOT NULL,
	"thumb_file_id" text,
	"tags" text[] DEFAULT '{}'::text[] NOT NULL,
	"share_ok" boolean DEFAULT false NOT NULL,
	"taken_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "visit_photos" ADD CONSTRAINT "visit_photos_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visit_photos" ADD CONSTRAINT "visit_photos_appointment_id_appointments_id_fk" FOREIGN KEY ("appointment_id") REFERENCES "public"."appointments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visit_photos" ADD CONSTRAINT "visit_photos_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visit_photos" ADD CONSTRAINT "visit_photos_service_id_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."services"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visit_photos" ADD CONSTRAINT "visit_photos_staff_id_staff_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."staff"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "visit_photos_appointment_idx" ON "visit_photos" USING btree ("appointment_id");--> statement-breakpoint
CREATE INDEX "visit_photos_gallery_idx" ON "visit_photos" USING btree ("business_id","taken_at");--> statement-breakpoint
CREATE INDEX "visit_photos_client_idx" ON "visit_photos" USING btree ("business_id","client_id");--> statement-breakpoint
CREATE INDEX "visit_photos_service_idx" ON "visit_photos" USING btree ("business_id","service_id");--> statement-breakpoint
CREATE INDEX "visit_photos_staff_idx" ON "visit_photos" USING btree ("business_id","staff_id");--> statement-breakpoint
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['visit_photos'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I FOR ALL USING (business_id = app_current_business_id()) WITH CHECK (business_id = app_current_business_id())',
      t
    );
  END LOOP;
END $$;
