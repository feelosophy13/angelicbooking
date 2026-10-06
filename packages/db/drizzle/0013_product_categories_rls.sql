ALTER TABLE product_categories ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE product_categories FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON product_categories FOR ALL USING (business_id = app_current_business_id()) WITH CHECK (business_id = app_current_business_id());
