CREATE TABLE "product_groups" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"business_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"image_url" text,
	"category_id" text,
	"kind" text DEFAULT 'retail' NOT NULL,
	"taxable" boolean DEFAULT true NOT NULL,
	"sell_online" boolean DEFAULT false NOT NULL,
	"supplier_id" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "group_id" text;--> statement-breakpoint
ALTER TABLE "product_groups" ADD CONSTRAINT "product_groups_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_groups" ADD CONSTRAINT "product_groups_category_id_product_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."product_categories"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_groups" ADD CONSTRAINT "product_groups_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "product_groups_business_idx" ON "product_groups" USING btree ("business_id","name");--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_group_id_product_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."product_groups"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "products_group_idx" ON "products" USING btree ("group_id");--> statement-breakpoint
ALTER TABLE product_groups ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE product_groups FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON product_groups FOR ALL USING (business_id = app_current_business_id()) WITH CHECK (business_id = app_current_business_id());
--> statement-breakpoint
-- Products that were already sold in options (same name, each with an option label) become one group; the group takes its shared details from the first of them.
INSERT INTO product_groups (business_id, name, description, image_url, category_id, kind, taxable, sell_online, supplier_id, active)
SELECT DISTINCT ON (p.business_id, p.name) p.business_id, p.name, p.description, p.image_url, p.category_id, p.kind, p.taxable, p.sell_online, p.supplier_id, true
FROM products p WHERE p.variant_label IS NOT NULL AND p.variant_label <> '' ORDER BY p.business_id, p.name, p.created_at;
--> statement-breakpoint
UPDATE products p SET group_id = g.id FROM product_groups g WHERE g.business_id = p.business_id AND g.name = p.name AND p.variant_label IS NOT NULL AND p.variant_label <> '';
