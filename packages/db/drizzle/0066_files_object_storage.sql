ALTER TABLE "files" ALTER COLUMN "data" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "files" ADD COLUMN "storage" text DEFAULT 'db' NOT NULL;--> statement-breakpoint
ALTER TABLE "files" ADD COLUMN "storage_key" text;--> statement-breakpoint
CREATE INDEX "files_storage_key_idx" ON "files" USING btree ("storage_key");