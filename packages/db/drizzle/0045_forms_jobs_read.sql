-- The morning forms nudge scans businesses with active forms from the jobs route (no tenant context yet).
CREATE POLICY jobs_read ON forms FOR SELECT USING (current_setting('app.jobs', true) = 'on');
