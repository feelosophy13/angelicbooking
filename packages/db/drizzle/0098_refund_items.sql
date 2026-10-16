-- Line-item refunds: which ticket lines a refund was for, so pay claws back exactly those lines.
CREATE TABLE "refund_items" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"business_id" text NOT NULL,
	"sale_id" text NOT NULL,
	"sale_line_id" text NOT NULL,
	"refund_id" text,
	"credit_ledger_id" text,
	"amount_cents" integer NOT NULL,
	"tax_cents" integer DEFAULT 0 NOT NULL,
	"quantity" integer DEFAULT 1 NOT NULL,
	"created_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "refund_items_amount_ck" CHECK ("refund_items"."amount_cents" > 0)
);--> statement-breakpoint
ALTER TABLE "refund_items" ADD CONSTRAINT "refund_items_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refund_items" ADD CONSTRAINT "refund_items_sale_id_sales_id_fk" FOREIGN KEY ("sale_id") REFERENCES "public"."sales"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refund_items" ADD CONSTRAINT "refund_items_sale_line_id_sale_lines_id_fk" FOREIGN KEY ("sale_line_id") REFERENCES "public"."sale_lines"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refund_items" ADD CONSTRAINT "refund_items_refund_id_refunds_id_fk" FOREIGN KEY ("refund_id") REFERENCES "public"."refunds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refund_items" ADD CONSTRAINT "refund_items_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "refund_items_sale_idx" ON "refund_items" USING btree ("sale_id");--> statement-breakpoint
CREATE INDEX "refund_items_refund_idx" ON "refund_items" USING btree ("refund_id");--> statement-breakpoint
CREATE INDEX "refund_items_business_created_idx" ON "refund_items" USING btree ("business_id","created_at");--> statement-breakpoint
ALTER TABLE "refund_items" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "refund_items" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON "refund_items";--> statement-breakpoint
CREATE POLICY tenant_isolation ON "refund_items" FOR ALL USING (business_id = app_current_business_id()) WITH CHECK (business_id = app_current_business_id());
