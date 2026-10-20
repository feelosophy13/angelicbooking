-- Verify the client's phone (or email) with a one-time code before an online booking (Settings → Booking rules). On by default.
ALTER TABLE "businesses" ADD COLUMN IF NOT EXISTS "verify_booking_contact" boolean DEFAULT true NOT NULL;--> statement-breakpoint
-- Booking codes go to someone who may not be a client yet: no client row, and a purpose that keeps them apart from sign-in codes.
ALTER TABLE "client_login_codes" ALTER COLUMN "client_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "client_login_codes" ADD COLUMN IF NOT EXISTS "purpose" text DEFAULT 'login' NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "client_login_codes_destination_idx" ON "client_login_codes" ("business_id", "purpose", "destination", "created_at");
