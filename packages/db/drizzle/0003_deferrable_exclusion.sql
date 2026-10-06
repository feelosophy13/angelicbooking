-- Make the no-double-booking constraint deferrable so a transaction can shift
-- several segments of the same service (e.g. colour + finish) together and have
-- overlap checked once at commit instead of after each row.
ALTER TABLE appointment_items DROP CONSTRAINT IF EXISTS appointment_items_no_double_booking;
--> statement-breakpoint
ALTER TABLE appointment_items
  ADD CONSTRAINT appointment_items_no_double_booking
  EXCLUDE USING gist (
    staff_id WITH =,
    tstzrange(start_at, end_at, '[)') WITH &&
  )
  WHERE (status NOT IN ('cancelled', 'no_show'))
  DEFERRABLE INITIALLY IMMEDIATE;
