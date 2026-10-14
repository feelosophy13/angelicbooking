ALTER TABLE "businesses" ADD COLUMN "suspended_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "businesses" ADD COLUMN "suspended_reason" text;--> statement-breakpoint
ALTER TABLE "businesses" ADD COLUMN "comped" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
-- The admin app may change only these columns of a business (suspend, comp, extend a trial).
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'angelic_admin') THEN
    GRANT UPDATE (suspended_at, suspended_reason, comped, trial_ends_at, updated_at) ON businesses TO angelic_admin;
  END IF;
END $$;
