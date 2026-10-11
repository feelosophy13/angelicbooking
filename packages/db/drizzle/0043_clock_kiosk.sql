ALTER TABLE "locations" ADD COLUMN "clock_token" text;--> statement-breakpoint
ALTER TABLE "staff" ADD COLUMN "clock_pin_hash" text;--> statement-breakpoint
ALTER TABLE "time_entries" ADD COLUMN "location_id" text;--> statement-breakpoint
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "locations" ADD CONSTRAINT "locations_clock_token_unique" UNIQUE("clock_token");