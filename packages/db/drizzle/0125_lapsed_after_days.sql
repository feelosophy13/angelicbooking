-- "Consider a client lapsed after N days" (Settings → Booking rules). Reports counts a client as churned once this many days pass
-- after their last completed visit with nothing booked; the We miss you automation's own day count is shown next to it. 90 by default.
ALTER TABLE "businesses" ADD COLUMN IF NOT EXISTS "lapsed_after_days" integer NOT NULL DEFAULT 90;
