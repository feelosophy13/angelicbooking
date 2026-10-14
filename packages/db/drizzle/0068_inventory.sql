CREATE TYPE "public"."purchase_order_status" AS ENUM('draft', 'ordered', 'partial', 'received', 'cancelled');--> statement-breakpoint
CREATE TABLE "product_stock" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"business_id" text NOT NULL,
	"product_id" text NOT NULL,
	"location_id" text NOT NULL,
	"qty" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "purchase_order_lines" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"business_id" text NOT NULL,
	"purchase_order_id" text NOT NULL,
	"product_id" text NOT NULL,
	"ordered_qty" integer NOT NULL,
	"received_qty" integer DEFAULT 0 NOT NULL,
	"unit_cost_cents" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "purchase_orders" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"business_id" text NOT NULL,
	"number" integer NOT NULL,
	"supplier_id" text,
	"location_id" text,
	"status" "purchase_order_status" DEFAULT 'draft' NOT NULL,
	"expected_on" text,
	"ordered_at" timestamp with time zone,
	"received_at" timestamp with time zone,
	"reference" text,
	"notes" text,
	"created_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "service_products" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"business_id" text NOT NULL,
	"service_id" text NOT NULL,
	"product_id" text NOT NULL,
	"quantity" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "suppliers" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"business_id" text NOT NULL,
	"name" text NOT NULL,
	"contact_name" text,
	"email" text,
	"phone" text,
	"account_number" text,
	"notes" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DROP INDEX "stock_movements_sale_product_uq";--> statement-breakpoint
ALTER TABLE "businesses" ADD COLUMN "inventory_digest_on" text;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "barcode" text;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "variant_label" text;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "kind" text DEFAULT 'retail' NOT NULL;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "reorder_up_to" integer;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "supplier_id" text;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD COLUMN "location_id" text;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD COLUMN "purchase_order_id" text;--> statement-breakpoint
ALTER TABLE "product_stock" ADD CONSTRAINT "product_stock_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_stock" ADD CONSTRAINT "product_stock_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_stock" ADD CONSTRAINT "product_stock_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_order_lines" ADD CONSTRAINT "purchase_order_lines_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_order_lines" ADD CONSTRAINT "purchase_order_lines_purchase_order_id_purchase_orders_id_fk" FOREIGN KEY ("purchase_order_id") REFERENCES "public"."purchase_orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_order_lines" ADD CONSTRAINT "purchase_order_lines_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_products" ADD CONSTRAINT "service_products_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_products" ADD CONSTRAINT "service_products_service_id_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."services"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_products" ADD CONSTRAINT "service_products_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "product_stock_uq" ON "product_stock" USING btree ("product_id","location_id");--> statement-breakpoint
CREATE INDEX "product_stock_business_idx" ON "product_stock" USING btree ("business_id","location_id");--> statement-breakpoint
CREATE UNIQUE INDEX "purchase_order_lines_uq" ON "purchase_order_lines" USING btree ("purchase_order_id","product_id");--> statement-breakpoint
CREATE UNIQUE INDEX "purchase_orders_number_uq" ON "purchase_orders" USING btree ("business_id","number");--> statement-breakpoint
CREATE INDEX "purchase_orders_status_idx" ON "purchase_orders" USING btree ("business_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "service_products_uq" ON "service_products" USING btree ("service_id","product_id");--> statement-breakpoint
CREATE INDEX "service_products_product_idx" ON "service_products" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX "suppliers_business_idx" ON "suppliers" USING btree ("business_id","name");--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "products_barcode_idx" ON "products" USING btree ("business_id","barcode");--> statement-breakpoint
CREATE INDEX "stock_movements_business_created_idx" ON "stock_movements" USING btree ("business_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "stock_movements_sale_product_uq" ON "stock_movements" USING btree ("sale_id","product_id","reason") WHERE "stock_movements"."reason" in ('sale', 'used');--> statement-breakpoint
-- Tenant isolation for the new tables.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['product_stock','service_products','suppliers','purchase_orders','purchase_order_lines'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I FOR ALL USING (business_id = app_current_business_id()) WITH CHECK (business_id = app_current_business_id())',
      t
    );
  END LOOP;
END $$;
--> statement-breakpoint
-- Purchase order numbers per business, like receipt numbers.
CREATE OR REPLACE FUNCTION next_purchase_order_number(p_business_id text) RETURNS integer
LANGUAGE plpgsql AS $$
DECLARE n integer;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('po_number:' || p_business_id));
  SELECT coalesce(max(number), 0) + 1 INTO n FROM purchase_orders WHERE business_id = p_business_id;
  RETURN n;
END $$;
--> statement-breakpoint
-- Existing stock lives at each business's main location, and its history is stamped with it.
UPDATE stock_movements m SET location_id = d.id FROM locations d WHERE m.location_id IS NULL AND d.business_id = m.business_id AND d.is_default;
--> statement-breakpoint
INSERT INTO product_stock (business_id, product_id, location_id, qty)
SELECT p.business_id, p.id, d.id, p.stock_qty FROM products p JOIN locations d ON d.business_id = p.business_id AND d.is_default
WHERE p.track_stock OR p.stock_qty <> 0
ON CONFLICT DO NOTHING;
--> statement-breakpoint
-- Refunds no longer put goods back on the shelf by themselves; returns are recorded on purpose.
UPDATE stock_movements SET reason = 'return' WHERE reason = 'refund';
--> statement-breakpoint
-- Managers run inventory by default (the owner always can). Other roles opt in under Roles & permissions.
UPDATE roles SET permissions = array_append(permissions, 'inventory.manage') WHERE key = 'manager' AND is_system AND NOT ('inventory.manage' = ANY(permissions));
