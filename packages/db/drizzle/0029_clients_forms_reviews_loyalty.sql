ALTER TYPE "public"."payment_method" ADD VALUE 'loyalty';--> statement-breakpoint
CREATE TABLE "client_login_codes" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"business_id" text NOT NULL,
	"client_id" text NOT NULL,
	"channel" text NOT NULL,
	"destination" text NOT NULL,
	"code_hash" text NOT NULL,
	"attempts" smallint DEFAULT 0 NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "form_submissions" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"business_id" text NOT NULL,
	"form_id" text NOT NULL,
	"client_id" text NOT NULL,
	"appointment_id" text,
	"answers" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"signature_name" text,
	"signed_at" timestamp with time zone,
	"ip_address" text,
	"form_snapshot" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "forms" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"business_id" text NOT NULL,
	"name" text NOT NULL,
	"kind" text DEFAULT 'intake' NOT NULL,
	"description" text,
	"fields" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"require_signature" boolean DEFAULT true NOT NULL,
	"apply_to_all" boolean DEFAULT false NOT NULL,
	"service_ids" text[] DEFAULT '{}'::text[] NOT NULL,
	"renew_days" integer,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "loyalty_ledger" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"business_id" text NOT NULL,
	"client_id" text NOT NULL,
	"delta" integer NOT NULL,
	"reason" text NOT NULL,
	"sale_id" text,
	"note" text,
	"created_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reviews" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"business_id" text NOT NULL,
	"client_id" text,
	"appointment_id" text,
	"staff_id" text,
	"token" text DEFAULT encode(gen_random_bytes(18), 'hex') NOT NULL,
	"rating" smallint,
	"comment" text,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"submitted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reviews_rating_ck" CHECK ("reviews"."rating" is null or ("reviews"."rating" between 1 and 5))
);
--> statement-breakpoint
ALTER TABLE "businesses" ADD COLUMN "review_request_enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "businesses" ADD COLUMN "review_request_delay_hours" integer DEFAULT 2 NOT NULL;--> statement-breakpoint
ALTER TABLE "businesses" ADD COLUMN "google_review_url" text;--> statement-breakpoint
ALTER TABLE "businesses" ADD COLUMN "loyalty_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "businesses" ADD COLUMN "loyalty_points_per_dollar" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "businesses" ADD COLUMN "loyalty_points_per_visit" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "businesses" ADD COLUMN "loyalty_point_value_cents" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "businesses" ADD COLUMN "loyalty_min_redeem_points" integer DEFAULT 500 NOT NULL;--> statement-breakpoint
ALTER TABLE "businesses" ADD COLUMN "referral_bonus_points" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "businesses" ADD COLUMN "referral_friend_bonus_points" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "businesses" ADD COLUMN "client_accounts_enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "birthday" date;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "review_opt_out" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "referral_code" text;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "referred_by_client_id" text;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "referral_rewarded_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "last_login_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "client_login_codes" ADD CONSTRAINT "client_login_codes_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_login_codes" ADD CONSTRAINT "client_login_codes_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "form_submissions" ADD CONSTRAINT "form_submissions_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "form_submissions" ADD CONSTRAINT "form_submissions_form_id_forms_id_fk" FOREIGN KEY ("form_id") REFERENCES "public"."forms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "form_submissions" ADD CONSTRAINT "form_submissions_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "form_submissions" ADD CONSTRAINT "form_submissions_appointment_id_appointments_id_fk" FOREIGN KEY ("appointment_id") REFERENCES "public"."appointments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "forms" ADD CONSTRAINT "forms_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loyalty_ledger" ADD CONSTRAINT "loyalty_ledger_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loyalty_ledger" ADD CONSTRAINT "loyalty_ledger_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_appointment_id_appointments_id_fk" FOREIGN KEY ("appointment_id") REFERENCES "public"."appointments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_staff_id_staff_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."staff"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "client_login_codes_client_idx" ON "client_login_codes" USING btree ("business_id","client_id","created_at");--> statement-breakpoint
CREATE INDEX "form_submissions_client_idx" ON "form_submissions" USING btree ("business_id","client_id","created_at");--> statement-breakpoint
CREATE INDEX "form_submissions_appointment_idx" ON "form_submissions" USING btree ("appointment_id");--> statement-breakpoint
CREATE INDEX "forms_business_idx" ON "forms" USING btree ("business_id");--> statement-breakpoint
CREATE INDEX "loyalty_ledger_client_idx" ON "loyalty_ledger" USING btree ("business_id","client_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "loyalty_ledger_sale_reason_uq" ON "loyalty_ledger" USING btree ("sale_id","reason");--> statement-breakpoint
CREATE UNIQUE INDEX "reviews_token_uq" ON "reviews" USING btree ("token");--> statement-breakpoint
CREATE UNIQUE INDEX "reviews_appointment_uq" ON "reviews" USING btree ("appointment_id");--> statement-breakpoint
CREATE INDEX "reviews_business_idx" ON "reviews" USING btree ("business_id","submitted_at");--> statement-breakpoint
CREATE UNIQUE INDEX "clients_referral_code_uq" ON "clients" USING btree ("business_id","referral_code");--> statement-breakpoint
CREATE INDEX "clients_birthday_idx" ON "clients" USING btree ("business_id","birthday");