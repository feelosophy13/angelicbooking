-- The ticket that started a membership, so refunding that line cancels it (a refund of a later renewal ticket rolls back one period instead).
ALTER TABLE "client_memberships" ADD COLUMN IF NOT EXISTS "sale_id" text REFERENCES "sales"("id") ON DELETE SET NULL;
