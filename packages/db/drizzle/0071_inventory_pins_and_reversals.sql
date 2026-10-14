CREATE TABLE "inventory_pins" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"business_id" text NOT NULL,
	"user_id" text NOT NULL,
	"product_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "stock_movements" ADD COLUMN "reverses_movement_id" text;--> statement-breakpoint
ALTER TABLE "inventory_pins" ADD CONSTRAINT "inventory_pins_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_pins" ADD CONSTRAINT "inventory_pins_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "inventory_pins_uq" ON "inventory_pins" USING btree ("user_id","product_id");--> statement-breakpoint
CREATE UNIQUE INDEX "stock_movements_reverses_uq" ON "stock_movements" USING btree ("reverses_movement_id") WHERE "stock_movements"."reverses_movement_id" is not null;--> statement-breakpoint
ALTER TABLE inventory_pins ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE inventory_pins FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON inventory_pins FOR ALL USING (business_id = app_current_business_id()) WITH CHECK (business_id = app_current_business_id());
