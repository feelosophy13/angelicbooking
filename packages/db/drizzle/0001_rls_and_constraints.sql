-- Tenant isolation + scheduling integrity.
-- Applied once; drizzle-kit does not manage these objects.

CREATE EXTENSION IF NOT EXISTS btree_gist;
--> statement-breakpoint

-- Helper: the current tenant for this transaction (NULL when unset => no rows visible).
CREATE OR REPLACE FUNCTION app_current_business_id() RETURNS text
LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('app.business_id', true), '')
$$;
--> statement-breakpoint

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'locations','staff','staff_schedules','staff_schedule_overrides',
    'service_categories','services','staff_services','clients',
    'appointments','appointment_items','audit_log'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    -- FORCE so the table owner (the app role in dev) is also subject to RLS.
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I FOR ALL USING (business_id = app_current_business_id()) WITH CHECK (business_id = app_current_business_id())',
      t
    );
  END LOOP;
END $$;
--> statement-breakpoint

-- A staff member can never have two live appointment items overlapping in time,
-- regardless of application bugs or concurrent requests.
ALTER TABLE appointment_items
  ADD CONSTRAINT appointment_items_no_double_booking
  EXCLUDE USING gist (
    staff_id WITH =,
    tstzrange(start_at, end_at, '[)') WITH &&
  )
  WHERE (status NOT IN ('cancelled', 'no_show'));
--> statement-breakpoint

-- Items must belong to the same tenant as their parent appointment.
CREATE OR REPLACE FUNCTION appointment_items_check_tenant() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM appointments a WHERE a.id = NEW.appointment_id AND a.business_id = NEW.business_id
  ) THEN
    RAISE EXCEPTION 'appointment_items.business_id must match parent appointment';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS appointment_items_tenant_trg ON appointment_items;
--> statement-breakpoint
CREATE TRIGGER appointment_items_tenant_trg
  BEFORE INSERT OR UPDATE ON appointment_items
  FOR EACH ROW EXECUTE FUNCTION appointment_items_check_tenant();
