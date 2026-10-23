-- Treatment charts (SOAP notes): templates the salon designs, charts filled in per client and visit, and addenda to signed charts.
-- A signed chart is locked: the trigger below refuses any change to what was recorded or to the signature, so the record holds even if
-- the app has a bug. Addenda are never edited. Links to the visit, service, provider and template may still go blank when those are
-- deleted (ON DELETE SET NULL), which is not a change to the record.
CREATE TABLE IF NOT EXISTS "chart_templates" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"business_id" text NOT NULL REFERENCES "public"."businesses"("id") ON DELETE cascade,
	"name" text NOT NULL,
	"description" text,
	"fields" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"service_ids" text[] DEFAULT '{}'::text[] NOT NULL,
	"starter_key" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "chart_templates_business_idx" ON "chart_templates" USING btree ("business_id");--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "chart_notes" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"business_id" text NOT NULL REFERENCES "public"."businesses"("id") ON DELETE cascade,
	"client_id" text NOT NULL REFERENCES "public"."clients"("id") ON DELETE cascade,
	"appointment_id" text REFERENCES "public"."appointments"("id") ON DELETE set null,
	"service_id" text REFERENCES "public"."services"("id") ON DELETE set null,
	"staff_id" text REFERENCES "public"."staff"("id") ON DELETE set null,
	"template_id" text REFERENCES "public"."chart_templates"("id") ON DELETE set null,
	"template_snapshot" jsonb NOT NULL,
	"answers" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"service_name" text,
	"author_user_id" text REFERENCES "public"."user"("id") ON DELETE set null,
	"author_name" text NOT NULL,
	"signed_at" timestamp with time zone,
	"signed_by_user_id" text REFERENCES "public"."user"("id") ON DELETE set null,
	"signed_by_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "chart_notes_client_idx" ON "chart_notes" USING btree ("business_id","client_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "chart_notes_appointment_idx" ON "chart_notes" USING btree ("appointment_id");--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "chart_addenda" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"business_id" text NOT NULL REFERENCES "public"."businesses"("id") ON DELETE cascade,
	"note_id" text NOT NULL REFERENCES "public"."chart_notes"("id") ON DELETE cascade,
	"author_user_id" text REFERENCES "public"."user"("id") ON DELETE set null,
	"author_name" text NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "chart_addenda_note_idx" ON "chart_addenda" USING btree ("note_id","created_at");--> statement-breakpoint
ALTER TABLE "chart_templates" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "chart_templates" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "chart_notes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "chart_notes" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "chart_addenda" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "chart_addenda" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON "chart_templates";--> statement-breakpoint
CREATE POLICY tenant_isolation ON "chart_templates" FOR ALL USING (business_id = app_current_business_id()) WITH CHECK (business_id = app_current_business_id());--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON "chart_notes";--> statement-breakpoint
CREATE POLICY tenant_isolation ON "chart_notes" FOR ALL USING (business_id = app_current_business_id()) WITH CHECK (business_id = app_current_business_id());--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON "chart_addenda";--> statement-breakpoint
CREATE POLICY tenant_isolation ON "chart_addenda" FOR ALL USING (business_id = app_current_business_id()) WITH CHECK (business_id = app_current_business_id());--> statement-breakpoint
CREATE OR REPLACE FUNCTION chart_notes_signed_lock() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.signed_at IS NOT NULL AND (
    NEW.answers IS DISTINCT FROM OLD.answers OR NEW.template_snapshot IS DISTINCT FROM OLD.template_snapshot
    OR NEW.signed_at IS DISTINCT FROM OLD.signed_at OR NEW.signed_by_name IS DISTINCT FROM OLD.signed_by_name
    OR (NEW.signed_by_user_id IS DISTINCT FROM OLD.signed_by_user_id AND NEW.signed_by_user_id IS NOT NULL)
    OR NEW.client_id IS DISTINCT FROM OLD.client_id OR NEW.author_name IS DISTINCT FROM OLD.author_name OR NEW.business_id IS DISTINCT FROM OLD.business_id
  ) THEN
    RAISE EXCEPTION 'chart % is signed and locked; add an addendum instead', OLD.id USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;--> statement-breakpoint
DROP TRIGGER IF EXISTS chart_notes_signed_lock ON "chart_notes";--> statement-breakpoint
CREATE TRIGGER chart_notes_signed_lock BEFORE UPDATE ON "chart_notes" FOR EACH ROW EXECUTE FUNCTION chart_notes_signed_lock();--> statement-breakpoint
CREATE OR REPLACE FUNCTION chart_addenda_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.body IS DISTINCT FROM OLD.body OR NEW.author_name IS DISTINCT FROM OLD.author_name OR NEW.created_at IS DISTINCT FROM OLD.created_at
    OR NEW.note_id IS DISTINCT FROM OLD.note_id OR (NEW.author_user_id IS DISTINCT FROM OLD.author_user_id AND NEW.author_user_id IS NOT NULL) THEN
    RAISE EXCEPTION 'chart addenda are never changed' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;--> statement-breakpoint
DROP TRIGGER IF EXISTS chart_addenda_append_only ON "chart_addenda";--> statement-breakpoint
CREATE TRIGGER chart_addenda_append_only BEFORE UPDATE ON "chart_addenda" FOR EACH ROW EXECUTE FUNCTION chart_addenda_append_only();--> statement-breakpoint
-- Who gets the new permissions on stored roles (built-in copies and custom ones): every client's charts for roles that manage the team
-- (the Manager default), their own clients' charts for roles that read notes and update their own appointments (the Provider default).
-- The front desk gets none: charts are clinical records, and the owner ticks them on under Roles where the desk needs them.
UPDATE "roles" SET "permissions" = array_append("permissions", 'charts.read.any') WHERE 'staff.manage' = ANY("permissions") AND 'clients.notes' = ANY("permissions") AND NOT ('charts.read.any' = ANY("permissions"));--> statement-breakpoint
UPDATE "roles" SET "permissions" = array_append("permissions", 'charts.write.any') WHERE 'staff.manage' = ANY("permissions") AND 'clients.notes' = ANY("permissions") AND NOT ('charts.write.any' = ANY("permissions"));--> statement-breakpoint
UPDATE "roles" SET "permissions" = array_append("permissions", 'charts.read.own') WHERE 'clients.notes' = ANY("permissions") AND 'appointments.write.own' = ANY("permissions") AND ('staff.manage' = ANY("permissions") OR NOT ('appointments.read.any' = ANY("permissions"))) AND NOT ('charts.read.own' = ANY("permissions"));--> statement-breakpoint
UPDATE "roles" SET "permissions" = array_append("permissions", 'charts.write.own') WHERE 'clients.notes' = ANY("permissions") AND 'appointments.write.own' = ANY("permissions") AND ('staff.manage' = ANY("permissions") OR NOT ('appointments.read.any' = ANY("permissions"))) AND NOT ('charts.write.own' = ANY("permissions"));
