-- What the client agreed to when booking online: the cancellation policy as shown, when, and from where (evidence for a disputed fee).
ALTER TABLE "appointments" ADD COLUMN IF NOT EXISTS "policy_text" text;--> statement-breakpoint
ALTER TABLE "appointments" ADD COLUMN IF NOT EXISTS "policy_accepted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "appointments" ADD COLUMN IF NOT EXISTS "policy_accepted_ip" text;
