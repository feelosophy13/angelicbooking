ALTER TABLE "service_products" ADD COLUMN "mode" text DEFAULT 'auto' NOT NULL;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD COLUMN "appointment_id" text;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD COLUMN "unit_cost_cents" integer;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_appointment_id_appointments_id_fk" FOREIGN KEY ("appointment_id") REFERENCES "public"."appointments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
-- Movements so far were all at the product's current cost.
UPDATE stock_movements m SET unit_cost_cents = p.cost_cents FROM products p WHERE p.id = m.product_id AND m.unit_cost_cents IS NULL;
--> statement-breakpoint
-- Front desk and providers may log the supplies they used; the owner can switch it off per role.
UPDATE roles SET permissions = array_append(permissions, 'inventory.log') WHERE key IN ('front_desk', 'provider') AND is_system AND NOT ('inventory.log' = ANY(permissions));
--> statement-breakpoint
UPDATE roles SET permissions = array_append(permissions, 'inventory.log') WHERE key = 'manager' AND is_system AND NOT ('inventory.log' = ANY(permissions));
