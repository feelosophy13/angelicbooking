-- The calendar's week (Week view, Month, the mini date picker) starts on the business's own first day: Monday by default, Sunday for
-- the many US salons that think of the week that way. 0 = Sunday … 6 = Saturday, like JavaScript's getDay().
ALTER TABLE "businesses" ADD COLUMN IF NOT EXISTS "week_start" smallint NOT NULL DEFAULT 1;
