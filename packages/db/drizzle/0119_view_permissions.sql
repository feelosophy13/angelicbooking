-- Phase 1 of PERMISSIONS-PLAN-2026-10-18.md: the "view" permissions that several areas lacked, and the own / everyone axis for
-- reviews and sales. Until now reviews rode on clients.read; the staff directory, the menu, products, packages and plans needed only
-- membership; the waitlist and Staff hours rode on appointments.read.any; everyone's time clock rode on staff.manage; client contact
-- details and spend were inseparable from clients.read; the API let a key creator mint staff:read and reviews:read with nothing behind it.
--
-- New permissions and where they come from, for every stored role (built-in copies and custom ones alike), so nobody loses what they
-- have today. The owner can then take things away under Roles. The owner role is not stored as a permission list (it always has
-- everything), so it needs no row here.
--   clients.contact, clients.spend   ← clients.read (today's gate for phone, email, address, birthday, spend and tips)
--   reviews.view                     ← clients.read (today's gate for the Reviews page)
--   reviews.view.own                 ← roles that see their own calendar but not everyone's (appointments.read.own without read.any)
--   waitlist.view                    ← appointments.read.any;  waitlist.manage ← appointments.write.any
--   sales.view.all                   ← checkout.take with appointments.read.any (today they saw every ticket)
--   sales.view.own                   ← checkout.take without appointments.read.any (today they saw their own)
--   giftcards.view                   ← giftcards.issue or reports.view (today's gate for the Gift cards page)
--   staff.directory                  ← every role (today every member saw the staff list)
--   staff.schedules.view             ← appointments.read.any (today's gate for Staff hours; the staff list showed days to everyone)
--   time.view.all, time.edit         ← staff.manage
--   catalog.view, catalog.prices     ← every role (today every member saw the menu with prices)
--   catalog.costs                    ← services.manage or inventory.manage (today's gate for product cost and the export)
--   inventory.view                   ← inventory.manage or inventory.log (today's gate for stock counts and the team's usage list)
--   forms.manage                     ← business.manage (today's gate for Settings → Forms)
UPDATE "roles" SET "permissions" = array_append("permissions", 'clients.contact') WHERE 'clients.read' = ANY("permissions") AND NOT ('clients.contact' = ANY("permissions"));--> statement-breakpoint
UPDATE "roles" SET "permissions" = array_append("permissions", 'clients.spend') WHERE 'clients.read' = ANY("permissions") AND NOT ('clients.spend' = ANY("permissions"));--> statement-breakpoint
UPDATE "roles" SET "permissions" = array_append("permissions", 'reviews.view') WHERE 'clients.read' = ANY("permissions") AND NOT ('reviews.view' = ANY("permissions"));--> statement-breakpoint
UPDATE "roles" SET "permissions" = array_append("permissions", 'reviews.view.own') WHERE 'appointments.read.own' = ANY("permissions") AND NOT ('appointments.read.any' = ANY("permissions")) AND NOT ('reviews.view.own' = ANY("permissions"));--> statement-breakpoint
UPDATE "roles" SET "permissions" = array_append("permissions", 'waitlist.view') WHERE 'appointments.read.any' = ANY("permissions") AND NOT ('waitlist.view' = ANY("permissions"));--> statement-breakpoint
UPDATE "roles" SET "permissions" = array_append("permissions", 'waitlist.manage') WHERE 'appointments.write.any' = ANY("permissions") AND NOT ('waitlist.manage' = ANY("permissions"));--> statement-breakpoint
UPDATE "roles" SET "permissions" = array_append("permissions", 'sales.view.all') WHERE 'checkout.take' = ANY("permissions") AND 'appointments.read.any' = ANY("permissions") AND NOT ('sales.view.all' = ANY("permissions"));--> statement-breakpoint
UPDATE "roles" SET "permissions" = array_append("permissions", 'sales.view.own') WHERE 'checkout.take' = ANY("permissions") AND NOT ('appointments.read.any' = ANY("permissions")) AND NOT ('sales.view.own' = ANY("permissions"));--> statement-breakpoint
UPDATE "roles" SET "permissions" = array_append("permissions", 'giftcards.view') WHERE ('giftcards.issue' = ANY("permissions") OR 'reports.view' = ANY("permissions")) AND NOT ('giftcards.view' = ANY("permissions"));--> statement-breakpoint
UPDATE "roles" SET "permissions" = array_append("permissions", 'staff.directory') WHERE NOT ('staff.directory' = ANY("permissions"));--> statement-breakpoint
UPDATE "roles" SET "permissions" = array_append("permissions", 'staff.schedules.view') WHERE 'appointments.read.any' = ANY("permissions") AND NOT ('staff.schedules.view' = ANY("permissions"));--> statement-breakpoint
UPDATE "roles" SET "permissions" = array_append("permissions", 'time.view.all') WHERE 'staff.manage' = ANY("permissions") AND NOT ('time.view.all' = ANY("permissions"));--> statement-breakpoint
UPDATE "roles" SET "permissions" = array_append("permissions", 'time.edit') WHERE 'staff.manage' = ANY("permissions") AND NOT ('time.edit' = ANY("permissions"));--> statement-breakpoint
UPDATE "roles" SET "permissions" = array_append("permissions", 'catalog.view') WHERE NOT ('catalog.view' = ANY("permissions"));--> statement-breakpoint
UPDATE "roles" SET "permissions" = array_append("permissions", 'catalog.prices') WHERE NOT ('catalog.prices' = ANY("permissions"));--> statement-breakpoint
UPDATE "roles" SET "permissions" = array_append("permissions", 'catalog.costs') WHERE ('services.manage' = ANY("permissions") OR 'inventory.manage' = ANY("permissions")) AND NOT ('catalog.costs' = ANY("permissions"));--> statement-breakpoint
UPDATE "roles" SET "permissions" = array_append("permissions", 'inventory.view') WHERE ('inventory.manage' = ANY("permissions") OR 'inventory.log' = ANY("permissions")) AND NOT ('inventory.view' = ANY("permissions"));--> statement-breakpoint
UPDATE "roles" SET "permissions" = array_append("permissions", 'forms.manage') WHERE 'business.manage' = ANY("permissions") AND NOT ('forms.manage' = ANY("permissions"));
