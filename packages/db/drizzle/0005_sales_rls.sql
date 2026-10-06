DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['products','sales','sale_lines','payments','refunds'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I FOR ALL USING (business_id = app_current_business_id()) WITH CHECK (business_id = app_current_business_id())',
      t
    );
  END LOOP;
END $$;
--> statement-breakpoint
-- Per-business receipt numbers without a sequence per tenant: next = max + 1 under a row lock.
CREATE OR REPLACE FUNCTION next_sale_number(p_business_id text) RETURNS integer
LANGUAGE plpgsql AS $$
DECLARE n integer;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('sale_number:' || p_business_id));
  SELECT coalesce(max(number), 1000) + 1 INTO n FROM sales WHERE business_id = p_business_id;
  RETURN n;
END $$;
