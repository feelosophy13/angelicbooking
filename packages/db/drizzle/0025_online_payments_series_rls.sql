ALTER TABLE appointment_series ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE appointment_series FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON appointment_series FOR ALL USING (business_id = app_current_business_id()) WITH CHECK (business_id = app_current_business_id());
