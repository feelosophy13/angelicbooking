CREATE TABLE "staff_pay_rates" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"business_id" text NOT NULL,
	"staff_id" text NOT NULL,
	"effective_from" date NOT NULL,
	"pay_type" "pay_type" NOT NULL,
	"main_commission_bps" integer DEFAULT 0 NOT NULL,
	"product_commission_bps" integer DEFAULT 0 NOT NULL,
	"cc_tip_fee_bps" integer DEFAULT 0 NOT NULL,
	"hourly_rate_cents" integer DEFAULT 0 NOT NULL,
	"salary_per_period_cents" integer DEFAULT 0 NOT NULL,
	"overtime_override" boolean,
	"tax_deduction_cents" integer,
	"tax_deduction_bps" integer,
	"note" text,
	"created_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "staff_pay_rates" ADD CONSTRAINT "staff_pay_rates_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_pay_rates" ADD CONSTRAINT "staff_pay_rates_staff_id_staff_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."staff"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "staff_pay_rates_staff_idx" ON "staff_pay_rates" USING btree ("business_id","staff_id","effective_from");--> statement-breakpoint
-- Every existing staff member starts with one history row: today's settings, in force since they were added.
INSERT INTO "staff_pay_rates" ("business_id", "staff_id", "effective_from", "pay_type", "main_commission_bps", "product_commission_bps", "cc_tip_fee_bps", "hourly_rate_cents", "salary_per_period_cents", "overtime_override", "tax_deduction_cents", "tax_deduction_bps", "note")
SELECT "business_id", "id", ("created_at" AT TIME ZONE 'UTC')::date, "pay_type", "main_commission_bps", "product_commission_bps", "cc_tip_fee_bps", "hourly_rate_cents", "salary_per_period_cents", "overtime_override", "tax_deduction_cents", "tax_deduction_bps", 'Settings when history began'
FROM "staff";
