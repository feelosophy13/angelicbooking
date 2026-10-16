-- Earning (and taking back earnings) happens once per sale; redeeming points and giving points back on a refund can happen more than
-- once per ticket, which the old (sale, reason) index blocked (an error page on a second redemption, lost points on a second refund).
DROP INDEX IF EXISTS "loyalty_ledger_sale_reason_uq";--> statement-breakpoint
CREATE UNIQUE INDEX "loyalty_ledger_sale_reason_uq" ON "loyalty_ledger" USING btree ("sale_id","reason") WHERE "loyalty_ledger"."reason" in ('earn','referral','referral_friend','refund');
