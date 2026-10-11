ALTER TABLE "messaging_numbers" ADD COLUMN "location_id" text;--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "location_id" text;--> statement-breakpoint
ALTER TABLE "gift_cards" ADD COLUMN "valid_location_ids" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "membership_plans" ADD COLUMN "valid_location_ids" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "packages" ADD COLUMN "valid_location_ids" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "messaging_numbers" ADD CONSTRAINT "messaging_numbers_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE set null ON UPDATE no action;