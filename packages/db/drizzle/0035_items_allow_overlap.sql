ALTER TABLE "appointment_items" ADD COLUMN "allow_overlap" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE appointment_items DROP CONSTRAINT IF EXISTS appointment_items_no_double_booking;
--> statement-breakpoint
ALTER TABLE appointment_items
  ADD CONSTRAINT appointment_items_no_double_booking
  EXCLUDE USING gist (
    staff_id WITH =,
    tstzrange(start_at, end_at, '[)') WITH &&
  )
  WHERE (status NOT IN ('cancelled', 'no_show') AND class_session_id IS NULL AND NOT allow_overlap)
  DEFERRABLE INITIALLY IMMEDIATE;
