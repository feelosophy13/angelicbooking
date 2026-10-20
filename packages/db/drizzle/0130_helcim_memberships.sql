-- Helcim memberships renew from the app (no Helcim subscription): the saved card token each renewal is charged to.
ALTER TABLE "client_memberships" ADD COLUMN IF NOT EXISTS "helcim_card_token" text;
