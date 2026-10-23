-- Invoices: a bill a salon sends a client (a bridal party, an event, a balance owed, a deposit for a big job) that the client pays online.
-- The money side is an ordinary open sale (source 'invoice'): its lines, discount, tax and payments are the sale's, so a paid invoice is a
-- paid sale for reports, payroll, tips and refunds. This row adds what only an invoice has: the client's link, the due date, the note, the
-- deposit asked for now, and when it was sent, opened and reminded.
CREATE TABLE IF NOT EXISTS "invoices" (
  "id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
  "business_id" text NOT NULL REFERENCES "businesses"("id") ON DELETE CASCADE,
  "sale_id" text NOT NULL REFERENCES "sales"("id") ON DELETE CASCADE,
  "token" text NOT NULL,
  "status" text DEFAULT 'draft' NOT NULL,
  "due_on" text,
  "note" text,
  "deposit_type" text,
  "deposit_value" integer,
  "remind" boolean DEFAULT true NOT NULL,
  "reminders_sent" text[] DEFAULT '{}'::text[] NOT NULL,
  "receipted_payment_ids" text[] DEFAULT '{}'::text[] NOT NULL,
  "sent_to_email" text,
  "sent_to_phone" text,
  "sent_at" timestamp with time zone,
  "viewed_at" timestamp with time zone,
  "paid_at" timestamp with time zone,
  "voided_at" timestamp with time zone,
  "created_by_user_id" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "invoices_status_ck" CHECK ("status" in ('draft', 'sent', 'void')),
  CONSTRAINT "invoices_deposit_ck" CHECK ("deposit_type" is null or ("deposit_type" in ('percent', 'amount') and "deposit_value" > 0))
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "invoices_sale_uq" ON "invoices" ("sale_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "invoices_token_uq" ON "invoices" ("token");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "invoices_business_idx" ON "invoices" ("business_id", "status", "due_on");--> statement-breakpoint
ALTER TABLE "invoices" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "invoices" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DO $$ BEGIN
  CREATE POLICY tenant_isolation ON "invoices" FOR ALL USING (business_id = app_current_business_id()) WITH CHECK (business_id = app_current_business_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
-- The reminder job finds invoices coming due across businesses (read only), then works on each inside its own tenant.
DO $$ BEGIN
  CREATE POLICY jobs_read ON "invoices" FOR SELECT USING (current_setting('app.jobs', true) = 'on');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
