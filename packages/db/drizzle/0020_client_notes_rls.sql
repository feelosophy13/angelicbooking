ALTER TABLE client_notes ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE client_notes FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON client_notes FOR ALL USING (business_id = app_current_business_id()) WITH CHECK (business_id = app_current_business_id());
