-- Birthday and no-visit workflows are scanned once a day (the day is recorded here) instead of on every 5-minute job.
ALTER TABLE "workflows" ADD COLUMN "last_scan_on" date;
