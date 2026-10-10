ALTER TABLE forms ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE forms FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON forms FOR ALL USING (business_id = app_current_business_id()) WITH CHECK (business_id = app_current_business_id());
--> statement-breakpoint
ALTER TABLE form_submissions ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE form_submissions FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON form_submissions FOR ALL USING (business_id = app_current_business_id()) WITH CHECK (business_id = app_current_business_id());
--> statement-breakpoint
ALTER TABLE reviews ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE reviews FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON reviews FOR ALL USING (business_id = app_current_business_id()) WITH CHECK (business_id = app_current_business_id());
--> statement-breakpoint
ALTER TABLE loyalty_ledger ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE loyalty_ledger FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON loyalty_ledger FOR ALL USING (business_id = app_current_business_id()) WITH CHECK (business_id = app_current_business_id());
--> statement-breakpoint
ALTER TABLE client_login_codes ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE client_login_codes FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON client_login_codes FOR ALL USING (business_id = app_current_business_id()) WITH CHECK (business_id = app_current_business_id());
