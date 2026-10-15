/** What an API key may do. A key carries a list of these; `x:write` implies `x:read`. Pure, shared by the API, the key form and the docs. */
export const API_SCOPES = [
  // group: how the key form lists them. sensitive: can change who may do what, or reach many clients at once; the form marks these.
  { scope: "catalog:read", group: "Catalog", label: "Read services, categories, products, packages, plans, locations and availability" },
  { scope: "catalog:write", group: "Catalog", label: "Create and change services, categories, products, packages and plans" },
  { scope: "inventory:read", group: "Inventory", label: "Read stock, suppliers, purchase orders and stock history" },
  { scope: "inventory:write", group: "Inventory", label: "Receive, count, transfer and adjust stock; manage suppliers and purchase orders" },
  { scope: "clients:read", group: "Clients", label: "Read clients, their notes, packages and memberships" },
  { scope: "clients:write", group: "Clients", label: "Create, update and delete clients and notes" },
  { scope: "appointments:read", group: "Appointments", label: "Read appointments, classes, standing appointments and the waitlist" },
  { scope: "appointments:write", group: "Appointments", label: "Book, move, change and cancel appointments, classes, blocks and the waitlist" },
  { scope: "forms:read", group: "Forms", label: "Read forms and what clients submitted" },
  { scope: "forms:write", group: "Forms", label: "Create and change forms; void or reassign submissions" },
  { scope: "reviews:read", group: "Reviews", label: "Read client reviews" },
  { scope: "sales:read", group: "Sales", label: "Read sales and payments (taking payments is not in the API)" },
  { scope: "staff:read", group: "Team", label: "Read staff contact details, hours, time off and time clock entries" },
  { scope: "staff:write", group: "Team", label: "Add and change staff, hours, time off, services and time clock entries", sensitive: true },
  { scope: "pay:read", group: "Team", label: "Read staff pay settings", sensitive: true },
  { scope: "pay:write", group: "Team", label: "Change staff pay settings", sensitive: true },
  { scope: "roles:read", group: "Team", label: "Read roles and permissions" },
  { scope: "roles:write", group: "Team", label: "Create and change roles and permissions", sensitive: true },
  { scope: "marketing:read", group: "Marketing", label: "Read campaigns, promo codes and automations" },
  { scope: "marketing:write", group: "Marketing", label: "Create campaigns (and send them), promo codes and automations", sensitive: true },
  { scope: "messages:read", group: "Messages", label: "Read texts and emails sent to clients, and replies from them" },
  { scope: "messages:write", group: "Messages", label: "Reply to clients by text", sensitive: true },
  { scope: "settings:read", group: "Settings", label: "Read business profile, booking rules, store, loyalty and notification settings" },
  { scope: "settings:write", group: "Settings", label: "Change business settings, locations and refund reasons", sensitive: true },
] as const satisfies readonly { scope: string; group: string; label: string; sensitive?: boolean }[];

export type ApiScope = (typeof API_SCOPES)[number]["scope"];

export const API_SCOPE_NAMES: readonly string[] = API_SCOPES.map((s) => s.scope);

export function isApiScope(x: unknown): x is ApiScope {
  return typeof x === "string" && API_SCOPE_NAMES.includes(x);
}

/** Whether a key holding `granted` may do something that needs `needed`. Unknown scopes grant nothing. */
export function hasScope(granted: readonly string[], needed: ApiScope): boolean {
  if (granted.includes(needed)) return true;
  if (needed.endsWith(":read")) return granted.includes(needed.replace(/:read$/, ":write"));
  return false;
}

export const API_KEY_PREFIX = "ab_live_";
