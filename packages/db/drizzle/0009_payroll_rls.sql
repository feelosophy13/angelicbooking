DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['time_entries','payroll_adjustments','payroll_runs'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I FOR ALL USING (business_id = app_current_business_id()) WITH CHECK (business_id = app_current_business_id())',
      t
    );
  END LOOP;
END $$;
