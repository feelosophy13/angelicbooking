ALTER TABLE "platform_pricing" ADD COLUMN "platform_fee_bps" integer;--> statement-breakpoint
ALTER TABLE "business_pricing" ADD COLUMN "platform_fee_bps" integer;
