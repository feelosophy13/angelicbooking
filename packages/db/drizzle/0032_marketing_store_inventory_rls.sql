ALTER TABLE campaigns ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE campaigns FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON campaigns FOR ALL USING (business_id = app_current_business_id()) WITH CHECK (business_id = app_current_business_id());
--> statement-breakpoint
ALTER TABLE automations ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE automations FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON automations FOR ALL USING (business_id = app_current_business_id()) WITH CHECK (business_id = app_current_business_id());
--> statement-breakpoint
ALTER TABLE automation_sends ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE automation_sends FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON automation_sends FOR ALL USING (business_id = app_current_business_id()) WITH CHECK (business_id = app_current_business_id());
--> statement-breakpoint
ALTER TABLE promo_codes ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE promo_codes FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON promo_codes FOR ALL USING (business_id = app_current_business_id()) WITH CHECK (business_id = app_current_business_id());
--> statement-breakpoint
ALTER TABLE inbound_messages ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE inbound_messages FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON inbound_messages FOR ALL USING (business_id = app_current_business_id()) WITH CHECK (business_id = app_current_business_id());
--> statement-breakpoint
ALTER TABLE stock_movements ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE stock_movements FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON stock_movements FOR ALL USING (business_id = app_current_business_id()) WITH CHECK (business_id = app_current_business_id());
--> statement-breakpoint
-- The daily marketing job scans enabled automations across tenants (withJobs); writes stay tenant-scoped.
CREATE POLICY jobs_read ON automations FOR SELECT USING (current_setting('app.jobs', true) = 'on');
--> statement-breakpoint
-- The inbound SMS webhook resolves the destination number to a business before any tenant context exists.
-- messaging_numbers already has jobs_read. Membership renewals arrive by Stripe subscription id:
CREATE POLICY jobs_read ON client_memberships FOR SELECT USING (current_setting('app.jobs', true) = 'on');
