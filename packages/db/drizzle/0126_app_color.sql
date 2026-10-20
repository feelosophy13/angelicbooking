-- The staff app's primary color (Settings → Business profile → App color): buttons, links and highlights in /app for everyone
-- at the business. #rrggbb; null = the default violet. Separate from brand_color, which colors the client-facing booking page.
ALTER TABLE "businesses" ADD COLUMN IF NOT EXISTS "app_color" text;
