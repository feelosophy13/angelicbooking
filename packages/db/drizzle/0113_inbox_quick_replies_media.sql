-- Inbox v2: saved quick replies per business (title + body with placeholders), and pictures attached to outgoing texts (MMS).
ALTER TABLE "businesses" ADD COLUMN IF NOT EXISTS "quick_replies" jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE "notifications" ADD COLUMN IF NOT EXISTS "media" jsonb NOT NULL DEFAULT '[]'::jsonb;
