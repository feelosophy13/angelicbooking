-- The provider calendar feed (/api/calendar/<token>.ics) is unauthenticated and resolves
-- the secret token to a staff row before any tenant context exists, so the jobs context
-- may READ staff across tenants (same mechanism as notifications / messaging_numbers).
CREATE POLICY jobs_read ON staff FOR SELECT USING (current_setting('app.jobs', true) = 'on');
