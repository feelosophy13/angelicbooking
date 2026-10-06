CREATE TYPE "public"."membership_status" AS ENUM('active', 'paused', 'cancelled');--> statement-breakpoint
ALTER TYPE "public"."payment_method" ADD VALUE 'gift_card';--> statement-breakpoint
ALTER TYPE "public"."sale_line_kind" ADD VALUE 'gift_card';--> statement-breakpoint
ALTER TYPE "public"."sale_line_kind" ADD VALUE 'package';--> statement-breakpoint
ALTER TYPE "public"."sale_line_kind" ADD VALUE 'membership';--> statement-breakpoint
CREATE TABLE "client_memberships" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"business_id" text NOT NULL,
	"client_id" text NOT NULL,
	"plan_id" text NOT NULL,
	"status" "membership_status" DEFAULT 'active' NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"current_period_end" timestamp with time zone NOT NULL,
	"credits_remaining" integer DEFAULT 0 NOT NULL,
	"stripe_subscription_id" text,
	"cancelled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "client_packages" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"business_id" text NOT NULL,
	"client_id" text NOT NULL,
	"package_id" text NOT NULL,
	"service_id" text NOT NULL,
	"remaining" integer NOT NULL,
	"sale_id" text,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "client_packages_remaining_ck" CHECK ("client_packages"."remaining" >= 0)
);
--> statement-breakpoint
CREATE TABLE "gift_cards" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"business_id" text NOT NULL,
	"code" text NOT NULL,
	"initial_cents" integer NOT NULL,
	"balance_cents" integer NOT NULL,
	"purchaser_client_id" text,
	"recipient_name" text,
	"sale_id" text,
	"expires_at" timestamp with time zone,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "gift_cards_balance_ck" CHECK ("gift_cards"."balance_cents" >= 0)
);
--> statement-breakpoint
CREATE TABLE "import_jobs" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"business_id" text NOT NULL,
	"kind" text NOT NULL,
	"filename" text NOT NULL,
	"row_count" integer DEFAULT 0 NOT NULL,
	"created" integer DEFAULT 0 NOT NULL,
	"updated" integer DEFAULT 0 NOT NULL,
	"skipped" integer DEFAULT 0 NOT NULL,
	"errors" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"mapping" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "membership_plans" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"business_id" text NOT NULL,
	"name" text NOT NULL,
	"price_cents" integer NOT NULL,
	"included_service_id" text,
	"included_sessions" integer DEFAULT 0 NOT NULL,
	"discount_bps" integer DEFAULT 0 NOT NULL,
	"description" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "packages" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"business_id" text NOT NULL,
	"name" text NOT NULL,
	"service_id" text NOT NULL,
	"sessions" integer NOT NULL,
	"price_cents" integer NOT NULL,
	"valid_days" integer,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "businesses" ADD COLUMN "custom_domain" text;--> statement-breakpoint
ALTER TABLE "staff" ADD COLUMN "location_id" text;--> statement-breakpoint
ALTER TABLE "client_memberships" ADD CONSTRAINT "client_memberships_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_memberships" ADD CONSTRAINT "client_memberships_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_memberships" ADD CONSTRAINT "client_memberships_plan_id_membership_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."membership_plans"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_packages" ADD CONSTRAINT "client_packages_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_packages" ADD CONSTRAINT "client_packages_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_packages" ADD CONSTRAINT "client_packages_package_id_packages_id_fk" FOREIGN KEY ("package_id") REFERENCES "public"."packages"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_packages" ADD CONSTRAINT "client_packages_sale_id_sales_id_fk" FOREIGN KEY ("sale_id") REFERENCES "public"."sales"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gift_cards" ADD CONSTRAINT "gift_cards_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gift_cards" ADD CONSTRAINT "gift_cards_purchaser_client_id_clients_id_fk" FOREIGN KEY ("purchaser_client_id") REFERENCES "public"."clients"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gift_cards" ADD CONSTRAINT "gift_cards_sale_id_sales_id_fk" FOREIGN KEY ("sale_id") REFERENCES "public"."sales"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_jobs" ADD CONSTRAINT "import_jobs_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "membership_plans" ADD CONSTRAINT "membership_plans_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "packages" ADD CONSTRAINT "packages_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "client_memberships_client_idx" ON "client_memberships" USING btree ("business_id","client_id");--> statement-breakpoint
CREATE INDEX "client_packages_client_idx" ON "client_packages" USING btree ("business_id","client_id");--> statement-breakpoint
CREATE UNIQUE INDEX "gift_cards_business_code_uq" ON "gift_cards" USING btree ("business_id","code");--> statement-breakpoint
CREATE INDEX "import_jobs_business_idx" ON "import_jobs" USING btree ("business_id","created_at");--> statement-breakpoint
CREATE INDEX "membership_plans_business_idx" ON "membership_plans" USING btree ("business_id");--> statement-breakpoint
CREATE INDEX "packages_business_idx" ON "packages" USING btree ("business_id");--> statement-breakpoint
ALTER TABLE "staff" ADD CONSTRAINT "staff_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "businesses" ADD CONSTRAINT "businesses_custom_domain_unique" UNIQUE("custom_domain");