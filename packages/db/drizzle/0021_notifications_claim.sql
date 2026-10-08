ALTER TYPE "public"."notification_status" ADD VALUE 'sending' BEFORE 'sent';--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "claimed_at" timestamp with time zone;--> statement-breakpoint
-- Background jobs (see withJobs in packages/db/src/tenant.ts) may READ notifications
-- across tenants to find due work. Writes stay tenant-scoped (tenant_isolation).
CREATE POLICY "jobs_read" ON "notifications" FOR SELECT USING (current_setting('app.jobs', true) = 'on');
