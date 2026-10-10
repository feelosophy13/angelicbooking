ALTER TABLE class_sessions ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE class_sessions FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON class_sessions FOR ALL USING (business_id = app_current_business_id()) WITH CHECK (business_id = app_current_business_id());
--> statement-breakpoint
-- Seats in a class share the instructor's time on purpose: exempt them from the
-- one-client-per-slot constraint (capacity is enforced in the enrolment transaction).
ALTER TABLE appointment_items DROP CONSTRAINT IF EXISTS appointment_items_no_double_booking;
--> statement-breakpoint
ALTER TABLE appointment_items
  ADD CONSTRAINT appointment_items_no_double_booking
  EXCLUDE USING gist (
    staff_id WITH =,
    tstzrange(start_at, end_at, '[)') WITH &&
  )
  WHERE (status NOT IN ('cancelled', 'no_show') AND class_session_id IS NULL)
  DEFERRABLE INITIALLY IMMEDIATE;
