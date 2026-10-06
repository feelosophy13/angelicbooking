CREATE TYPE "public"."pay_type" AS ENUM('commission', 'hourly', 'salary');--> statement-breakpoint
CREATE TYPE "public"."payroll_run_status" AS ENUM('draft', 'finalized');--> statement-breakpoint
CREATE TABLE "payroll_adjustments" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"business_id" text NOT NULL,
	"staff_id" text NOT NULL,
	"period_start" date NOT NULL,
	"period_end" date NOT NULL,
	"label" text NOT NULL,
	"amount_cents" integer NOT NULL,
	"created_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payroll_runs" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"business_id" text NOT NULL,
	"period_start" date NOT NULL,
	"period_end" date NOT NULL,
	"status" "payroll_run_status" DEFAULT 'finalized' NOT NULL,
	"overtime" boolean DEFAULT false NOT NULL,
	"snapshot" jsonb NOT NULL,
	"created_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "time_entries" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"business_id" text NOT NULL,
	"staff_id" text NOT NULL,
	"date" date NOT NULL,
	"minutes" integer DEFAULT 0 NOT NULL,
	"clock_in_at" timestamp with time zone,
	"clock_out_at" timestamp with time zone,
	"note" text,
	"created_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "time_entries_minutes_ck" CHECK ("time_entries"."minutes" >= 0)
);
--> statement-breakpoint
ALTER TABLE "appointments" ALTER COLUMN "manage_token" SET DEFAULT encode(gen_random_bytes(18), 'hex');--> statement-breakpoint
ALTER TABLE "staff" ADD COLUMN "position" text;--> statement-breakpoint
ALTER TABLE "staff" ADD COLUMN "pay_type" "pay_type" DEFAULT 'commission' NOT NULL;--> statement-breakpoint
ALTER TABLE "staff" ADD COLUMN "main_commission_bps" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "staff" ADD COLUMN "product_commission_bps" integer DEFAULT 500 NOT NULL;--> statement-breakpoint
ALTER TABLE "staff" ADD COLUMN "cc_tip_fee_bps" integer DEFAULT 300 NOT NULL;--> statement-breakpoint
ALTER TABLE "staff" ADD COLUMN "hourly_rate_cents" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "staff" ADD COLUMN "salary_per_period_cents" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "staff" ADD COLUMN "overtime_override" boolean;--> statement-breakpoint
ALTER TABLE "staff" ADD COLUMN "tax_deduction_cents" integer;--> statement-breakpoint
ALTER TABLE "staff" ADD COLUMN "tax_deduction_bps" integer;--> statement-breakpoint
ALTER TABLE "payroll_adjustments" ADD CONSTRAINT "payroll_adjustments_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_adjustments" ADD CONSTRAINT "payroll_adjustments_staff_id_staff_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."staff"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_runs" ADD CONSTRAINT "payroll_runs_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_staff_id_staff_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."staff"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "payroll_adjustments_period_idx" ON "payroll_adjustments" USING btree ("business_id","period_start","period_end");--> statement-breakpoint
CREATE UNIQUE INDEX "payroll_runs_period_uq" ON "payroll_runs" USING btree ("business_id","period_start","period_end");--> statement-breakpoint
CREATE INDEX "time_entries_staff_date_idx" ON "time_entries" USING btree ("business_id","staff_id","date");