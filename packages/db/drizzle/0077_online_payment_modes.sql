ALTER TABLE "services" ADD COLUMN "deposit_type" text DEFAULT 'flat' NOT NULL;--> statement-breakpoint
ALTER TABLE "services" ADD COLUMN "deposit_percent" smallint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "businesses" ADD COLUMN "require_mobile" boolean DEFAULT false NOT NULL;
