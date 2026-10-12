ALTER TABLE "businesses" ADD COLUMN "late_cancel_fee_type" text DEFAULT 'none' NOT NULL;--> statement-breakpoint
ALTER TABLE "businesses" ADD COLUMN "late_cancel_fee_value" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "businesses" ADD COLUMN "late_cancel_deposit" text DEFAULT 'toward' NOT NULL;