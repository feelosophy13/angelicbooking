-- Email designs: block layouts made in the designer. "saved" ones are picked by campaigns and workflow emails; a "system" one (key:
-- confirmation, reminder, receipt, …) replaces the look of that automatic email until it is reset to the default.
CREATE TABLE IF NOT EXISTS "email_templates" (
  "id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
  "business_id" text NOT NULL REFERENCES "businesses"("id") ON DELETE CASCADE,
  "kind" text DEFAULT 'saved' NOT NULL,
  "key" text,
  "name" text NOT NULL,
  "subject" text DEFAULT '' NOT NULL,
  "preheader" text DEFAULT '' NOT NULL,
  "blocks" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "updated_by_user_id" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "email_templates_business_idx" ON "email_templates" ("business_id", "kind", "updated_at");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "email_templates_key_uq" ON "email_templates" ("business_id", "key") WHERE key is not null;--> statement-breakpoint
ALTER TABLE "email_templates" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "email_templates" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "email_templates" FOR ALL USING (business_id = app_current_business_id()) WITH CHECK (business_id = app_current_business_id());--> statement-breakpoint
-- A campaign laid out with a saved design; deleting the design sends the campaign's plain message instead.
ALTER TABLE "campaigns" ADD COLUMN IF NOT EXISTS "template_id" text REFERENCES "email_templates"("id") ON DELETE SET NULL;
