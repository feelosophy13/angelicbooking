CREATE TABLE "admin_users" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"email" text NOT NULL,
	"name" text,
	"password_hash" text,
	"disabled_at" timestamp with time zone,
	"last_login_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE UNIQUE INDEX "admin_users_email_uq" ON "admin_users" USING btree (lower("email"));--> statement-breakpoint
-- The single operator whose password was reset from the admin app becomes the first admin account.
INSERT INTO "admin_users" ("email", "password_hash") SELECT lower("email"), "password_hash" FROM "admin_credentials" WHERE "id" = 'admin' AND "email" <> '' ON CONFLICT DO NOTHING;
