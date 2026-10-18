-- "Business settings" (business.manage) used to cover every Settings page, including the Stripe connection, the platform subscription and
-- card, API keys, the text number purchase and verification, and the activity log. Those are now their own permissions:
--   billing.manage       Settings → Payments (Stripe connection and payouts) and Settings → Billing (subscription and card on file)
--   integrations.manage  Settings → API keys, and buying, verifying or releasing the text number
--   audit.view           Settings → Activity log
-- business.manage keeps the everyday settings: profile, booking rules, locations, wording, store, loyalty, reviews, refund and
-- cancellation reasons, forms, imports, embed, custom domain, the Message log, the Loyalty page and Marketing automations.
--
-- Stored roles (built-in copies and custom ones alike) are back-filled so nobody loses what they had. The rule:
--   * every role that has business.manage gets billing.manage, integrations.manage and audit.view (it could already open all of those
--     pages, so this changes nothing for it; the owner can untick any of them under Roles);
--   * nothing else changes: a stored Manager role does NOT gain business.manage even though the Manager default now includes it (and
--     audit.view). The owner opts in under Roles, as with every earlier default change.
-- The owner role is not stored as a permission list (it always has everything), so it needs no row here.
UPDATE "roles" SET "permissions" = array_append("permissions", 'billing.manage') WHERE 'business.manage' = ANY("permissions") AND NOT ('billing.manage' = ANY("permissions"));--> statement-breakpoint
UPDATE "roles" SET "permissions" = array_append("permissions", 'integrations.manage') WHERE 'business.manage' = ANY("permissions") AND NOT ('integrations.manage' = ANY("permissions"));--> statement-breakpoint
UPDATE "roles" SET "permissions" = array_append("permissions", 'audit.view') WHERE 'business.manage' = ANY("permissions") AND NOT ('audit.view' = ANY("permissions"));
