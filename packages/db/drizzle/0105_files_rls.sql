-- `files` holds client photos, signed forms and staged imports (a whole client list): it gets the same tenant isolation as every other
-- business table. Looking a file up by its id before the business is known (the file route, the R2 move job) uses the jobs context.
ALTER TABLE "files" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "files" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON "files";--> statement-breakpoint
CREATE POLICY tenant_isolation ON "files" FOR ALL USING (business_id = app_current_business_id()) WITH CHECK (business_id = app_current_business_id());--> statement-breakpoint
DROP POLICY IF EXISTS jobs_read ON "files";--> statement-breakpoint
CREATE POLICY jobs_read ON "files" FOR SELECT USING (current_setting('app.jobs', true) = 'on');
