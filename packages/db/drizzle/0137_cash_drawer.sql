-- End-of-day close-out: a cash drawer per location (and per register, when a site runs more than one), opened with a float, with
-- pay-ins and payouts recorded during the day, and closed with a count. Expected cash at close is
--   opening float + cash taken − cash refunded − cash tips paid out + pay-ins − payouts
-- where "cash taken" and "cash refunded" are the cash payments and refunds stamped with the drawer (below).
CREATE TABLE IF NOT EXISTS "drawer_sessions" (
  "id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
  "business_id" text NOT NULL REFERENCES "businesses"("id") ON DELETE CASCADE,
  "location_id" text NOT NULL REFERENCES "locations"("id") ON DELETE CASCADE,
  "register" text DEFAULT 'Main' NOT NULL,
  "status" text DEFAULT 'open' NOT NULL,
  "opening_float_cents" integer NOT NULL,
  "opened_at" timestamp with time zone DEFAULT now() NOT NULL,
  "opened_by_user_id" text REFERENCES "user"("id") ON DELETE SET NULL,
  "closed_at" timestamp with time zone,
  "closed_by_user_id" text REFERENCES "user"("id") ON DELETE SET NULL,
  -- At close: what the drawer should have held, what was counted (and how, by denomination when given) and the difference.
  "expected_cents" integer,
  "counted_cents" integer,
  "over_short_cents" integer,
  "denominations" jsonb,
  "close_note" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "drawer_sessions_status_ck" CHECK ("status" IN ('open', 'closed')),
  CONSTRAINT "drawer_sessions_float_ck" CHECK ("opening_float_cents" >= 0),
  CONSTRAINT "drawer_sessions_closed_ck" CHECK ("status" = 'open' OR ("closed_at" IS NOT NULL AND "counted_cents" IS NOT NULL AND "expected_cents" IS NOT NULL))
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "drawer_sessions_open_uq" ON "drawer_sessions" ("location_id", lower("register")) WHERE "status" = 'open';--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "drawer_sessions_business_idx" ON "drawer_sessions" ("business_id", "location_id", "opened_at");--> statement-breakpoint
ALTER TABLE "drawer_sessions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "drawer_sessions" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DO $$ BEGIN
  CREATE POLICY tenant_isolation ON "drawer_sessions" FOR ALL USING (business_id = app_current_business_id()) WITH CHECK (business_id = app_current_business_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint

-- Cash put in or taken out during the day, each with a reason: a change run, petty cash, a tip handed to a stylist in cash.
CREATE TABLE IF NOT EXISTS "drawer_movements" (
  "id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
  "business_id" text NOT NULL REFERENCES "businesses"("id") ON DELETE CASCADE,
  "session_id" text NOT NULL REFERENCES "drawer_sessions"("id") ON DELETE CASCADE,
  "kind" text NOT NULL,
  "amount_cents" integer NOT NULL,
  "reason" text NOT NULL,
  -- A tip paid out: who received it.
  "staff_id" text REFERENCES "staff"("id") ON DELETE SET NULL,
  "created_by_user_id" text REFERENCES "user"("id") ON DELETE SET NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "drawer_movements_kind_ck" CHECK ("kind" IN ('pay_in', 'payout', 'tip_payout')),
  CONSTRAINT "drawer_movements_amount_ck" CHECK ("amount_cents" > 0)
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "drawer_movements_session_idx" ON "drawer_movements" ("session_id", "created_at");--> statement-breakpoint
ALTER TABLE "drawer_movements" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "drawer_movements" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DO $$ BEGIN
  CREATE POLICY tenant_isolation ON "drawer_movements" FOR ALL USING (business_id = app_current_business_id()) WITH CHECK (business_id = app_current_business_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint

-- Which drawer a cash payment went into, or a cash refund came out of. Stamped by the trigger below on every insert, so every path that
-- takes or returns cash (checkout, a late cash tip, a refund) lands in the open drawer at the ticket's location without each one having to
-- remember. Cash taken while no drawer is open stays unstamped (the closing report still counts it for the day).
ALTER TABLE "payments" ADD COLUMN IF NOT EXISTS "drawer_session_id" text REFERENCES "drawer_sessions"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "refunds" ADD COLUMN IF NOT EXISTS "drawer_session_id" text REFERENCES "drawer_sessions"("id") ON DELETE SET NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "payments_drawer_idx" ON "payments" ("drawer_session_id") WHERE "drawer_session_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "refunds_drawer_idx" ON "refunds" ("drawer_session_id") WHERE "drawer_session_id" IS NOT NULL;--> statement-breakpoint

-- With more than one register open at the site, the one the person taking the money opened wins, else the one open longest.
CREATE OR REPLACE FUNCTION app_stamp_cash_drawer() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  loc text;
BEGIN
  IF NEW.drawer_session_id IS NOT NULL THEN RETURN NEW; END IF;
  IF TG_TABLE_NAME = 'payments' THEN
    IF NEW.method <> 'cash' THEN RETURN NEW; END IF;
    SELECT s.location_id INTO loc FROM sales s WHERE s.id = NEW.sale_id;
  ELSE
    SELECT s.location_id INTO loc FROM payments p JOIN sales s ON s.id = p.sale_id WHERE p.id = NEW.payment_id AND p.method = 'cash';
  END IF;
  IF loc IS NULL THEN RETURN NEW; END IF;
  SELECT d.id INTO NEW.drawer_session_id FROM drawer_sessions d
    WHERE d.business_id = NEW.business_id AND d.location_id = loc AND d.status = 'open'
    ORDER BY (d.opened_by_user_id IS NOT DISTINCT FROM NEW.created_by_user_id) DESC, d.opened_at ASC
    LIMIT 1;
  RETURN NEW;
END $$;--> statement-breakpoint
DROP TRIGGER IF EXISTS payments_cash_drawer_trg ON "payments";--> statement-breakpoint
CREATE TRIGGER payments_cash_drawer_trg BEFORE INSERT ON "payments" FOR EACH ROW EXECUTE FUNCTION app_stamp_cash_drawer();--> statement-breakpoint
DROP TRIGGER IF EXISTS refunds_cash_drawer_trg ON "refunds";--> statement-breakpoint
CREATE TRIGGER refunds_cash_drawer_trg BEFORE INSERT ON "refunds" FOR EACH ROW EXECUTE FUNCTION app_stamp_cash_drawer();--> statement-breakpoint

-- New permission drawer.manage (open, record pay-ins and payouts, count and close the drawer). Stored roles that take payments and see
-- every ticket (the Front desk and Manager copies, and custom roles like them) get it; the closing report and history stay reports.view.
UPDATE "roles" SET "permissions" = array_append("permissions", 'drawer.manage') WHERE 'checkout.take' = ANY("permissions") AND 'sales.view.all' = ANY("permissions") AND NOT ('drawer.manage' = ANY("permissions"));
