-- scope_version: 1 = keys made before the finer scopes (their scopes are expanded to the finer ones when the key is used, so nothing a
-- key could do stops working); 2 = the stored scopes are exactly what the key may do (a write scope no longer includes its read scope).
ALTER TABLE "api_keys" ADD COLUMN "scope_version" smallint DEFAULT 1 NOT NULL;--> statement-breakpoint
-- Empty = any address. Otherwise only these addresses (or IPv4 ranges like 203.0.113.0/24) may use the key.
ALTER TABLE "api_keys" ADD COLUMN "allowed_ips" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
-- Requests per minute for this key; null = the default (120).
ALTER TABLE "api_keys" ADD COLUMN "rate_limit_per_min" integer;
