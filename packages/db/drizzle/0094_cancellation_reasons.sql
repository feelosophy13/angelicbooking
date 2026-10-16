CREATE TABLE "cancellation_reasons" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"business_id" text NOT NULL,
	"name" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"client_visible" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "cancellation_reasons" ADD CONSTRAINT "cancellation_reasons_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "cancellation_reasons_business_idx" ON "cancellation_reasons" USING btree ("business_id","sort_order");--> statement-breakpoint
ALTER TABLE "appointments" ADD COLUMN "cancellation_reason_id" text;--> statement-breakpoint
ALTER TABLE "appointments" ADD COLUMN "cancelled_by" text;--> statement-breakpoint
ALTER TABLE "appointments" ADD COLUMN "cancelled_late" boolean;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_cancellation_reason_id_fk" FOREIGN KEY ("cancellation_reason_id") REFERENCES "public"."cancellation_reasons"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cancellation_reasons" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "cancellation_reasons" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON "cancellation_reasons";--> statement-breakpoint
CREATE POLICY tenant_isolation ON "cancellation_reasons" FOR ALL USING (business_id = app_current_business_id()) WITH CHECK (business_id = app_current_business_id());
