ALTER TYPE "public"."payment_method" ADD VALUE 'store_credit';--> statement-breakpoint
CREATE TABLE "store_credit_ledger" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"business_id" text NOT NULL,
	"client_id" text NOT NULL,
	"delta_cents" integer NOT NULL,
	"reason" text NOT NULL,
	"sale_id" text,
	"payment_id" text,
	"appointment_id" text,
	"note" text,
	"created_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "businesses" ADD COLUMN "deposit_refund_as" text DEFAULT 'original' NOT NULL;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "store_credit_cents" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "store_credit_ledger" ADD CONSTRAINT "store_credit_ledger_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_credit_ledger" ADD CONSTRAINT "store_credit_ledger_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "store_credit_client_idx" ON "store_credit_ledger" USING btree ("business_id","client_id","created_at");