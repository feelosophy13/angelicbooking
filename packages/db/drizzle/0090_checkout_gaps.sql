ALTER TABLE "sales" ADD COLUMN "notes" text;--> statement-breakpoint
ALTER TABLE "sales" ADD COLUMN "tax_exempt" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "businesses" ADD COLUMN "receipt_footer" text;
