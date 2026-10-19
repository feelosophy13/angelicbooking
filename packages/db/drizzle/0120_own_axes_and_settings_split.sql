-- Phase 2 of PERMISSIONS-PLAN-2026-10-18.md: the own / everyone axes, self-service, and the end of the one "business settings" bucket.
--
-- New permissions and where stored roles (built-in copies and custom ones alike) get them from, so nobody loses what they use today:
--   clients.photos.own        ← clients.photos, for roles that see their own calendar but not everyone's (appointments.read.own without
--                               read.any); those roles then lose clients.photos: the plan gives a Provider their own visit photos, not everyone's
--   reports.staff             ← reports.view (today's gate for the per-staff table in Reports)
--   payroll.manage            ← payroll.view (a 1:1 rename; payroll.view is then removed)
--   checkout.tips.adjust      ← checkout.take with appointments.read.any (the desk and managers could add and move tips; a Provider could not)
--   classes.manage.any        ← appointments.write.any (today's gate for scheduling, filling and cancelling classes)
--   settings.business         ← business.manage (profile, locations, wording and number, reasons, embed, domain, import)
--   settings.booking          ← business.manage (booking rules, deposits, fees, store, loyalty, review requests, automations, message log)
--   business.manage is then removed (forms.manage was already back-filled from it in 0119)
-- Off for everyone until the owner ticks them under Roles: payroll.view.own, classes.manage.own, staff.self.hours, staff.self.services,
-- appointments.read.availability.
-- The owner role is not stored as a permission list (it always has everything), so it needs no permission row here.
UPDATE "roles" SET "permissions" = array_append(array_remove("permissions", 'clients.photos'), 'clients.photos.own') WHERE 'clients.photos' = ANY("permissions") AND 'appointments.read.own' = ANY("permissions") AND NOT ('appointments.read.any' = ANY("permissions")) AND NOT ('clients.photos.own' = ANY("permissions"));--> statement-breakpoint
UPDATE "roles" SET "permissions" = array_append("permissions", 'reports.staff') WHERE 'reports.view' = ANY("permissions") AND NOT ('reports.staff' = ANY("permissions"));--> statement-breakpoint
UPDATE "roles" SET "permissions" = array_append("permissions", 'payroll.manage') WHERE 'payroll.view' = ANY("permissions") AND NOT ('payroll.manage' = ANY("permissions"));--> statement-breakpoint
UPDATE "roles" SET "permissions" = array_remove("permissions", 'payroll.view') WHERE 'payroll.view' = ANY("permissions");--> statement-breakpoint
UPDATE "roles" SET "permissions" = array_append("permissions", 'checkout.tips.adjust') WHERE 'checkout.take' = ANY("permissions") AND 'appointments.read.any' = ANY("permissions") AND NOT ('checkout.tips.adjust' = ANY("permissions"));--> statement-breakpoint
UPDATE "roles" SET "permissions" = array_append("permissions", 'classes.manage.any') WHERE 'appointments.write.any' = ANY("permissions") AND NOT ('classes.manage.any' = ANY("permissions"));--> statement-breakpoint
UPDATE "roles" SET "permissions" = array_append("permissions", 'settings.business') WHERE 'business.manage' = ANY("permissions") AND NOT ('settings.business' = ANY("permissions"));--> statement-breakpoint
UPDATE "roles" SET "permissions" = array_append("permissions", 'settings.booking') WHERE 'business.manage' = ANY("permissions") AND NOT ('settings.booking' = ANY("permissions"));--> statement-breakpoint
UPDATE "roles" SET "permissions" = array_remove("permissions", 'business.manage') WHERE 'business.manage' = ANY("permissions");--> statement-breakpoint
-- The four built-in roles' descriptions, refreshed where the business never changed them, so the Roles page reads naturally to a salon owner.
UPDATE "roles" SET "description" = 'Everything, including payments, billing and API keys. Can''t be edited.' WHERE "is_system" AND "key" = 'owner' AND "description" = 'Full access, including billing and payments. Cannot be edited.';--> statement-breakpoint
UPDATE "roles" SET "description" = 'Runs the salon day to day: every calendar, client, ticket, report, payroll and setting. No Stripe, billing or API keys.' WHERE "is_system" AND "key" = 'manager' AND "description" IN ('Everything except Stripe, billing and API keys.', 'Everything except billing and payments.');--> statement-breakpoint
UPDATE "roles" SET "description" = 'Books and checks out for everyone: every calendar, client and ticket, the waitlist and gift cards. No reports, pay or settings.' WHERE "is_system" AND "key" = 'front_desk' AND "description" = 'All calendars, clients and checkout. No reports or setup.';--> statement-breakpoint
UPDATE "roles" SET "description" = 'Their own calendar, the clients they see (no contact details or spend), their own tickets, reviews and photos.' WHERE "is_system" AND "key" = 'provider' AND "description" = 'Their own calendar and checkout.';
