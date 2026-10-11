CREATE TABLE "refund_reasons" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"business_id" text NOT NULL,
	"name" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "store_credit_ledger" ADD COLUMN "refund_reason_id" text;--> statement-breakpoint
ALTER TABLE "refunds" ADD COLUMN "reason_id" text;--> statement-breakpoint
ALTER TABLE "refund_reasons" ADD CONSTRAINT "refund_reasons_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "refund_reasons_business_idx" ON "refund_reasons" USING btree ("business_id","sort_order");--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_reason_id_refund_reasons_id_fk" FOREIGN KEY ("reason_id") REFERENCES "public"."refund_reasons"("id") ON DELETE set null ON UPDATE no action;