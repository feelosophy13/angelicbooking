-- Locations as the money boundary: RLS for the new tables, and backfills so existing data
-- is already stamped with a location.
ALTER TABLE client_stripe_customers ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE client_stripe_customers FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON client_stripe_customers FOR ALL USING (business_id = app_current_business_id()) WITH CHECK (business_id = app_current_business_id());
--> statement-breakpoint
ALTER TABLE service_locations ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE service_locations FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON service_locations FOR ALL USING (business_id = app_current_business_id()) WITH CHECK (business_id = app_current_business_id());
--> statement-breakpoint
-- The Connect webhook resolves `event.account` to a business or a location before any tenant context exists.
CREATE POLICY jobs_read ON locations FOR SELECT USING (current_setting('app.jobs', true) = 'on');
--> statement-breakpoint
-- Existing Stripe customers were created on the business's main account.
INSERT INTO client_stripe_customers (business_id, client_id, stripe_account_id, customer_id)
SELECT c.business_id, c.id, b.stripe_account_id, c.stripe_customer_id
FROM clients c JOIN businesses b ON b.id = c.business_id
WHERE c.stripe_customer_id IS NOT NULL AND b.stripe_account_id IS NOT NULL
ON CONFLICT DO NOTHING;
--> statement-breakpoint
-- Weekly hours rows: in multi-location businesses make the location explicit (staff's primary
-- location, else the default location). Single-location businesses keep null (= the only one).
UPDATE staff_schedules ss SET location_id = COALESCE(s.location_id, d.id)
FROM staff s, locations d
WHERE ss.location_id IS NULL AND s.id = ss.staff_id AND d.business_id = ss.business_id AND d.is_default
  AND (SELECT count(*) FROM locations l WHERE l.business_id = ss.business_id) > 1;
--> statement-breakpoint
-- Sales: from the appointment, else the default location.
UPDATE sales s SET location_id = a.location_id FROM appointments a WHERE s.location_id IS NULL AND a.id = s.appointment_id AND a.location_id IS NOT NULL;
--> statement-breakpoint
UPDATE sales s SET location_id = d.id FROM locations d WHERE s.location_id IS NULL AND d.business_id = s.business_id AND d.is_default;
--> statement-breakpoint
-- Offers sold on a sale inherit its location.
UPDATE gift_cards g SET location_id = s.location_id FROM sales s WHERE g.location_id IS NULL AND s.id = g.sale_id;
--> statement-breakpoint
UPDATE client_packages p SET location_id = s.location_id FROM sales s WHERE p.location_id IS NULL AND s.id = p.sale_id;
--> statement-breakpoint
-- Client home location: most recent non-cancelled appointment with a location.
UPDATE clients c SET home_location_id = x.location_id
FROM (
  SELECT DISTINCT ON (a.client_id) a.client_id, a.location_id
  FROM appointments a JOIN appointment_items ai ON ai.appointment_id = a.id AND ai.sort_order = 0
  WHERE a.client_id IS NOT NULL AND a.location_id IS NOT NULL AND a.status NOT IN ('cancelled','no_show')
  ORDER BY a.client_id, ai.start_at DESC
) x
WHERE c.id = x.client_id;
