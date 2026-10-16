-- New permissions: discounts/price changes/voids (checkout.discount) and free gift cards (giftcards.issue). Built-in roles keep doing what
-- they did: Manager gets both, Front desk gets discounts. Custom roles get discounts only if they could already take payments AND see
-- reports (the closest thing to a supervisor before); owners can tick them for others under Roles.
UPDATE "roles" SET "permissions" = array_append("permissions", 'checkout.discount') WHERE "key" IN ('manager', 'front_desk') AND NOT ('checkout.discount' = ANY("permissions"));--> statement-breakpoint
UPDATE "roles" SET "permissions" = array_append("permissions", 'giftcards.issue') WHERE "key" = 'manager' AND NOT ('giftcards.issue' = ANY("permissions"));--> statement-breakpoint
UPDATE "roles" SET "permissions" = array_append("permissions", 'checkout.discount') WHERE "is_system" = false AND 'checkout.take' = ANY("permissions") AND 'reports.view' = ANY("permissions") AND NOT ('checkout.discount' = ANY("permissions"));
