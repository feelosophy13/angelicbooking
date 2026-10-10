ALTER TABLE "client_packages" ALTER COLUMN "service_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "packages" ALTER COLUMN "service_id" DROP NOT NULL;