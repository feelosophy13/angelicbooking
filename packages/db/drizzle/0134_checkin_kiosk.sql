-- Client self check-in kiosk: a tablet at the door opens /checkin/<token> for its location. Null token = off; issuing a new one
-- unpairs the old tablet. The business picks how early a client may check themselves in.
ALTER TABLE "locations" ADD COLUMN IF NOT EXISTS "checkin_token" text;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "locations" ADD CONSTRAINT "locations_checkin_token_unique" UNIQUE ("checkin_token");
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;--> statement-breakpoint
ALTER TABLE "businesses" ADD COLUMN IF NOT EXISTS "checkin_early_minutes" smallint DEFAULT 60 NOT NULL;
