CREATE TABLE "product_barcodes" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"business_id" text NOT NULL,
	"product_id" text NOT NULL,
	"code" text NOT NULL,
	"units_per_scan" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "product_barcodes" ADD CONSTRAINT "product_barcodes_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_barcodes" ADD CONSTRAINT "product_barcodes_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "product_barcodes_code_uq" ON "product_barcodes" USING btree ("business_id","code");--> statement-breakpoint
CREATE INDEX "product_barcodes_product_idx" ON "product_barcodes" USING btree ("product_id");--> statement-breakpoint
ALTER TABLE product_barcodes ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE product_barcodes FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON product_barcodes FOR ALL USING (business_id = app_current_business_id()) WITH CHECK (business_id = app_current_business_id());
