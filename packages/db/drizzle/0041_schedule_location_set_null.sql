ALTER TABLE "staff_schedules" DROP CONSTRAINT "staff_schedules_location_id_locations_id_fk";
--> statement-breakpoint
ALTER TABLE "staff_schedules" ADD CONSTRAINT "staff_schedules_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE set null ON UPDATE no action;