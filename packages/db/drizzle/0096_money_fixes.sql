-- A voided ticket no longer blocks ringing the visit up again (the index was unconditional, so re-opening after a void failed).
DROP INDEX IF EXISTS "sales_appointment_uq";--> statement-breakpoint
CREATE UNIQUE INDEX "sales_appointment_uq" ON "sales" USING btree ("appointment_id") WHERE "sales"."status" <> 'void';--> statement-breakpoint
-- The orphan-deposit sweep marks the payment_intent.succeeded events it has dealt with.
ALTER TABLE "webhook_events" ADD COLUMN "followed_up_at" timestamp with time zone;
