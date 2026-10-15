ALTER TABLE "notifications" ADD COLUMN "delivery_status" text;--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "delivered_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "inbound_messages" ADD COLUMN "media" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
CREATE INDEX "notifications_provider_idx" ON "notifications" USING btree ("provider_id");
