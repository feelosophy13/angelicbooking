ALTER TABLE "service_categories" ADD COLUMN "parent_id" text;--> statement-breakpoint
ALTER TABLE "service_categories" ADD COLUMN "description" text;--> statement-breakpoint
ALTER TABLE "service_categories" ADD COLUMN "image_url" text;--> statement-breakpoint
ALTER TABLE "services" ADD COLUMN "image_url" text;--> statement-breakpoint
ALTER TABLE "service_categories" ADD CONSTRAINT "service_categories_parent_id_service_categories_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."service_categories"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "service_categories_parent_idx" ON "service_categories" USING btree ("parent_id");