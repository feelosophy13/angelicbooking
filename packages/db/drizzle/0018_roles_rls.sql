ALTER TABLE roles ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE roles FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON roles FOR ALL USING (business_id = app_current_business_id()) WITH CHECK (business_id = app_current_business_id());
