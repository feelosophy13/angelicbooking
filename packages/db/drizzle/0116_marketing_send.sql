-- "View sales reports" (reports.view) used to open Marketing as well: campaigns (texting or emailing every client), promo codes, and
-- the Marketing sidebar entry. That is now its own permission:
--   marketing.send   Marketing → Campaigns and Promo codes, sending a campaign, and the Marketing sidebar entry
-- reports.view keeps the money reports. Automations were split between the two (list: reports.view, edit: business.manage) and are
-- now business.manage throughout.
--
-- Stored roles (built-in copies and custom ones alike) are back-filled so nobody loses what they had: every role that has reports.view
-- gets marketing.send (it could already open all of it; the owner can untick it under Roles). Nothing else changes. The owner role is not
-- stored as a permission list (it always has everything), so it needs no row here.
UPDATE "roles" SET "permissions" = array_append("permissions", 'marketing.send') WHERE 'reports.view' = ANY("permissions") AND NOT ('marketing.send' = ANY("permissions"));
