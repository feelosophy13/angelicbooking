CREATE TYPE "public"."payment_method" AS ENUM('cash', 'card', 'card_on_file', 'terminal', 'other');--> statement-breakpoint
CREATE TYPE "public"."payment_status" AS ENUM('pending', 'succeeded', 'failed', 'refunded', 'partially_refunded');--> statement-breakpoint
CREATE TYPE "public"."sale_line_kind" AS ENUM('service', 'product', 'tip', 'fee', 'adjustment');--> statement-breakpoint
CREATE TYPE "public"."sale_status" AS ENUM('open', 'paid', 'refunded', 'void');--> statement-breakpoint
CREATE TABLE "payments" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"business_id" text NOT NULL,
	"sale_id" text NOT NULL,
	"method" "payment_method" NOT NULL,
	"status" "payment_status" DEFAULT 'pending' NOT NULL,
	"amount_cents" integer NOT NULL,
	"tip_cents" integer DEFAULT 0 NOT NULL,
	"refunded_cents" integer DEFAULT 0 NOT NULL,
	"stripe_payment_intent_id" text,
	"stripe_charge_id" text,
	"card_brand" text,
	"card_last4" text,
	"note" text,
	"created_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payments_amount_ck" CHECK ("payments"."amount_cents" >= 0)
);
--> statement-breakpoint
CREATE TABLE "products" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"business_id" text NOT NULL,
	"name" text NOT NULL,
	"sku" text,
	"price_cents" integer NOT NULL,
	"taxable" boolean DEFAULT true NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "refunds" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"business_id" text NOT NULL,
	"payment_id" text NOT NULL,
	"amount_cents" integer NOT NULL,
	"reason" text,
	"stripe_refund_id" text,
	"created_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sale_lines" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"business_id" text NOT NULL,
	"sale_id" text NOT NULL,
	"kind" "sale_line_kind" NOT NULL,
	"staff_id" text,
	"service_id" text,
	"product_id" text,
	"appointment_item_id" text,
	"name" text NOT NULL,
	"quantity" integer DEFAULT 1 NOT NULL,
	"unit_cents" integer NOT NULL,
	"amount_cents" integer NOT NULL,
	"taxable" boolean DEFAULT false NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sales" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"business_id" text NOT NULL,
	"number" integer NOT NULL,
	"appointment_id" text,
	"client_id" text,
	"status" "sale_status" DEFAULT 'open' NOT NULL,
	"currency" text DEFAULT 'usd' NOT NULL,
	"subtotal_cents" integer DEFAULT 0 NOT NULL,
	"discount_cents" integer DEFAULT 0 NOT NULL,
	"tax_cents" integer DEFAULT 0 NOT NULL,
	"tip_cents" integer DEFAULT 0 NOT NULL,
	"total_cents" integer DEFAULT 0 NOT NULL,
	"paid_cents" integer DEFAULT 0 NOT NULL,
	"refunded_cents" integer DEFAULT 0 NOT NULL,
	"discount_note" text,
	"created_by_user_id" text,
	"closed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "webhook_events" (
	"id" text PRIMARY KEY NOT NULL,
	"provider" text DEFAULT 'stripe' NOT NULL,
	"type" text NOT NULL,
	"account_id" text,
	"payload" jsonb NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone,
	"error" text
);
--> statement-breakpoint
ALTER TABLE "businesses" ADD COLUMN "tax_rate_bps" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_sale_id_sales_id_fk" FOREIGN KEY ("sale_id") REFERENCES "public"."sales"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sale_lines" ADD CONSTRAINT "sale_lines_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sale_lines" ADD CONSTRAINT "sale_lines_sale_id_sales_id_fk" FOREIGN KEY ("sale_id") REFERENCES "public"."sales"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sale_lines" ADD CONSTRAINT "sale_lines_staff_id_staff_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."staff"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales" ADD CONSTRAINT "sales_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales" ADD CONSTRAINT "sales_appointment_id_appointments_id_fk" FOREIGN KEY ("appointment_id") REFERENCES "public"."appointments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales" ADD CONSTRAINT "sales_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales" ADD CONSTRAINT "sales_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "payments_sale_idx" ON "payments" USING btree ("sale_id");--> statement-breakpoint
CREATE INDEX "payments_business_created_idx" ON "payments" USING btree ("business_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "payments_pi_uq" ON "payments" USING btree ("stripe_payment_intent_id");--> statement-breakpoint
CREATE INDEX "products_business_idx" ON "products" USING btree ("business_id","name");--> statement-breakpoint
CREATE INDEX "refunds_payment_idx" ON "refunds" USING btree ("payment_id");--> statement-breakpoint
CREATE INDEX "sale_lines_sale_idx" ON "sale_lines" USING btree ("sale_id");--> statement-breakpoint
CREATE INDEX "sale_lines_business_staff_idx" ON "sale_lines" USING btree ("business_id","staff_id");--> statement-breakpoint
CREATE INDEX "sales_business_created_idx" ON "sales" USING btree ("business_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "sales_business_number_uq" ON "sales" USING btree ("business_id","number");--> statement-breakpoint
CREATE UNIQUE INDEX "sales_appointment_uq" ON "sales" USING btree ("appointment_id");--> statement-breakpoint
CREATE INDEX "webhook_events_type_idx" ON "webhook_events" USING btree ("type","received_at");