-- Membership "% off other services" applied to ticket lines (it was saved on plans but never used at checkout).
ALTER TABLE "sale_lines" ADD COLUMN "member_discount_bps" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "sale_lines" ADD COLUMN "pre_member_unit_cents" integer;
