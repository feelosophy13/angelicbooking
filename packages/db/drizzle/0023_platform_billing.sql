ALTER TABLE "businesses" ADD COLUMN "stripe_customer_id" text;--> statement-breakpoint
ALTER TABLE "businesses" ADD COLUMN "stripe_subscription_id" text;--> statement-breakpoint
ALTER TABLE "businesses" ADD COLUMN "subscription_status" text DEFAULT 'none' NOT NULL;--> statement-breakpoint
ALTER TABLE "businesses" ADD COLUMN "current_period_end" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "businesses" ADD COLUMN "trial_ends_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "messaging_numbers" ADD COLUMN "stripe_item_id" text;--> statement-breakpoint
ALTER TABLE "businesses" ADD CONSTRAINT "businesses_stripe_customer_id_unique" UNIQUE("stripe_customer_id");--> statement-breakpoint
ALTER TABLE "businesses" ADD CONSTRAINT "businesses_stripe_subscription_id_unique" UNIQUE("stripe_subscription_id");