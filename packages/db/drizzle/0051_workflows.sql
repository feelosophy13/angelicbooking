CREATE TABLE "workflow_runs" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"business_id" text NOT NULL,
	"workflow_id" text NOT NULL,
	"client_id" text,
	"appointment_id" text,
	"dedupe_key" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"step_index" integer DEFAULT 0 NOT NULL,
	"next_at" timestamp with time zone,
	"context" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"log" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "workflows" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"business_id" text NOT NULL,
	"template_key" text,
	"name" text NOT NULL,
	"description" text,
	"trigger" text NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"filters" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"steps" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"exit_on_booking" boolean DEFAULT false NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "workflow_run_id" text;--> statement-breakpoint
ALTER TABLE "workflow_runs" ADD CONSTRAINT "workflow_runs_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_runs" ADD CONSTRAINT "workflow_runs_workflow_id_workflows_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."workflows"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_runs" ADD CONSTRAINT "workflow_runs_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_runs" ADD CONSTRAINT "workflow_runs_appointment_id_appointments_id_fk" FOREIGN KEY ("appointment_id") REFERENCES "public"."appointments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflows" ADD CONSTRAINT "workflows_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "workflow_runs_dedupe_uq" ON "workflow_runs" USING btree ("workflow_id","dedupe_key");--> statement-breakpoint
CREATE INDEX "workflow_runs_due_idx" ON "workflow_runs" USING btree ("business_id","status","next_at");--> statement-breakpoint
CREATE INDEX "workflow_runs_appointment_idx" ON "workflow_runs" USING btree ("appointment_id");--> statement-breakpoint
CREATE INDEX "workflow_runs_client_idx" ON "workflow_runs" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "workflows_business_trigger_idx" ON "workflows" USING btree ("business_id","trigger");--> statement-breakpoint
CREATE UNIQUE INDEX "workflows_business_template_uq" ON "workflows" USING btree ("business_id","template_key");--> statement-breakpoint
ALTER TABLE workflows ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE workflows FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON workflows FOR ALL USING (business_id = app_current_business_id()) WITH CHECK (business_id = app_current_business_id());
--> statement-breakpoint
ALTER TABLE workflow_runs ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE workflow_runs FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON workflow_runs FOR ALL USING (business_id = app_current_business_id()) WITH CHECK (business_id = app_current_business_id());
--> statement-breakpoint
CREATE POLICY jobs_read ON workflows FOR SELECT USING (current_setting('app.jobs', true) = 'on');
--> statement-breakpoint
CREATE POLICY jobs_read ON workflow_runs FOR SELECT USING (current_setting('app.jobs', true) = 'on');
