ALTER TABLE "reviews" ADD COLUMN "location_id" text;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "reviews_business_location_idx" ON "reviews" USING btree ("business_id","location_id");--> statement-breakpoint
UPDATE "reviews" r SET "location_id" = a."location_id" FROM "appointments" a WHERE r."appointment_id" = a."id" AND r."location_id" IS NULL;
