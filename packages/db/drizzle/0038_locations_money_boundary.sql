CREATE TABLE "client_stripe_customers" (
	"business_id" text NOT NULL,
	"client_id" text NOT NULL,
	"stripe_account_id" text NOT NULL,
	"customer_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "client_stripe_customers_client_id_stripe_account_id_pk" PRIMARY KEY("client_id","stripe_account_id")
);
--> statement-breakpoint
CREATE TABLE "service_locations" (
	"business_id" text NOT NULL,
	"service_id" text NOT NULL,
	"location_id" text NOT NULL,
	CONSTRAINT "service_locations_service_id_location_id_pk" PRIMARY KEY("service_id","location_id")
);
--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "home_location_id" text;--> statement-breakpoint
ALTER TABLE "locations" ADD COLUMN "stripe_account_id" text;--> statement-breakpoint
ALTER TABLE "locations" ADD COLUMN "stripe_charges_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "locations" ADD COLUMN "stripe_details_submitted" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "locations" ADD COLUMN "tax_rate_bps" integer;--> statement-breakpoint
ALTER TABLE "client_memberships" ADD COLUMN "location_id" text;--> statement-breakpoint
ALTER TABLE "client_packages" ADD COLUMN "location_id" text;--> statement-breakpoint
ALTER TABLE "gift_cards" ADD COLUMN "location_id" text;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "gift_card_id" text;--> statement-breakpoint
ALTER TABLE "sale_lines" ADD COLUMN "client_package_id" text;--> statement-breakpoint
ALTER TABLE "sale_lines" ADD COLUMN "client_membership_id" text;--> statement-breakpoint
ALTER TABLE "sale_lines" ADD COLUMN "credit_cents" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "sales" ADD COLUMN "location_id" text;--> statement-breakpoint
ALTER TABLE "client_stripe_customers" ADD CONSTRAINT "client_stripe_customers_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_stripe_customers" ADD CONSTRAINT "client_stripe_customers_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_locations" ADD CONSTRAINT "service_locations_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_locations" ADD CONSTRAINT "service_locations_service_id_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."services"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_locations" ADD CONSTRAINT "service_locations_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "client_stripe_customers_business_idx" ON "client_stripe_customers" USING btree ("business_id");--> statement-breakpoint
CREATE INDEX "service_locations_business_idx" ON "service_locations" USING btree ("business_id");--> statement-breakpoint
ALTER TABLE "clients" ADD CONSTRAINT "clients_home_location_id_locations_id_fk" FOREIGN KEY ("home_location_id") REFERENCES "public"."locations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_memberships" ADD CONSTRAINT "client_memberships_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_packages" ADD CONSTRAINT "client_packages_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gift_cards" ADD CONSTRAINT "gift_cards_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales" ADD CONSTRAINT "sales_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sales_business_location_idx" ON "sales" USING btree ("business_id","location_id");