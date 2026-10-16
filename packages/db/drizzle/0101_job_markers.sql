-- Once-a-day platform jobs (billing reconcile, signup nudge) record the day they last ran instead of relying on the 5-minute job landing
-- in a 5-minute window.
CREATE TABLE "job_markers" (
	"name" text PRIMARY KEY NOT NULL,
	"last_run_on" date NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
