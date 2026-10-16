-- Tips recorded before 0092 have no cash/card choice. Where the sale was paid wholly one way it is certain: all by card means a card tip, no card payment at all
-- (cash, other, gift card, store credit, points) means a cash tip. Mixed sales stay unmarked and payroll keeps splitting them by the payment mix.
UPDATE "sale_lines" l SET "tip_method" = CASE
  WHEN NOT EXISTS (SELECT 1 FROM "payments" p WHERE p."sale_id" = l."sale_id" AND p."status" IN ('succeeded','partially_refunded','refunded') AND p."method" IN ('card','card_on_file','terminal')) THEN 'cash'
  WHEN NOT EXISTS (SELECT 1 FROM "payments" p WHERE p."sale_id" = l."sale_id" AND p."status" IN ('succeeded','partially_refunded','refunded') AND p."method" NOT IN ('card','card_on_file','terminal')) THEN 'card'
  ELSE NULL END
WHERE l."kind" = 'tip' AND l."tip_method" IS NULL
  AND EXISTS (SELECT 1 FROM "payments" p WHERE p."sale_id" = l."sale_id" AND p."status" IN ('succeeded','partially_refunded','refunded'));
