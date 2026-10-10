ALTER TABLE "staff" ADD COLUMN "takes_appointments" boolean DEFAULT true NOT NULL;--> statement-breakpoint
-- Existing staff who are not bookable online, perform no services and have never had an
-- appointment are support staff: keep them off the calendar.
UPDATE staff s SET takes_appointments = false
WHERE NOT s.bookable_online
  AND NOT EXISTS (SELECT 1 FROM staff_services ss WHERE ss.staff_id = s.id)
  AND NOT EXISTS (SELECT 1 FROM appointment_items ai WHERE ai.staff_id = s.id);
