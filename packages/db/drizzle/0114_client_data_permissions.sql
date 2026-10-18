-- "View clients" (clients.read) used to cover the client list as a CSV, every text conversation, the gallery, private notes and signed
-- forms, and store credit and loyalty balances. Those are now their own permissions: clients.export, clients.messages, clients.photos,
-- clients.notes, clients.balances. clients.read keeps meaning the list, a client's contact details and their visit history.
--
-- Stored roles (built-in copies and custom ones alike) are back-filled so nobody silently loses what they use day to day, and nobody
-- gains more than a close reading of their old permissions implies. The rule:
--   * every role that has clients.read gets clients.notes and clients.photos (formulas, allergies and a client's own photos are what
--     anyone who opens a client needs);
--   * a role that has clients.read AND clients.write also gets clients.messages and clients.balances (the desk reads and answers texts
--     and sees credit; a provider who cannot edit a client does not);
--   * clients.export is granted only to a role that has clients.read AND (reports.view OR members.manage): the people who already see
--     the whole business's numbers or run its logins. Nobody else gets the bulk download; an owner can tick it under Roles.
-- The owner role is not stored as a permission list (it always has everything), so it needs no row here.
UPDATE "roles" SET "permissions" = array_append("permissions", 'clients.notes') WHERE 'clients.read' = ANY("permissions") AND NOT ('clients.notes' = ANY("permissions"));--> statement-breakpoint
UPDATE "roles" SET "permissions" = array_append("permissions", 'clients.photos') WHERE 'clients.read' = ANY("permissions") AND NOT ('clients.photos' = ANY("permissions"));--> statement-breakpoint
UPDATE "roles" SET "permissions" = array_append("permissions", 'clients.messages') WHERE 'clients.read' = ANY("permissions") AND 'clients.write' = ANY("permissions") AND NOT ('clients.messages' = ANY("permissions"));--> statement-breakpoint
UPDATE "roles" SET "permissions" = array_append("permissions", 'clients.balances') WHERE 'clients.read' = ANY("permissions") AND 'clients.write' = ANY("permissions") AND NOT ('clients.balances' = ANY("permissions"));--> statement-breakpoint
UPDATE "roles" SET "permissions" = array_append("permissions", 'clients.export') WHERE 'clients.read' = ANY("permissions") AND ('reports.view' = ANY("permissions") OR 'members.manage' = ANY("permissions")) AND NOT ('clients.export' = ANY("permissions"));
