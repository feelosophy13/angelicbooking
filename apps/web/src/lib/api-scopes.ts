/**
 * What an API key may do. A key carries a list of these and every one is exact: `x:write` does NOT include `x:read` (a tool that only
 * creates things should not be able to list everything), and a destructive action has its own `:delete` scope. Pure, shared by the API,
 * the key form, the docs and the OpenAPI file.
 */
export const API_SCOPES = [
  // group: how the key form lists them. sensitive: can change who may do what, what clients are charged or who is messaged; the form marks these.
  { scope: "catalog:read", group: "Catalog", label: "Read services, categories, products, packages, plans, locations and availability" },
  { scope: "catalog:write", group: "Catalog", label: "Create and change services, categories, products, packages and plans (not their prices)" },
  { scope: "pricing:write", group: "Catalog", label: "Change prices, deposits and costs of services, packages, plans and products", sensitive: true },
  { scope: "catalog:delete", group: "Catalog", label: "Delete categories and extra barcodes" },
  { scope: "inventory:read", group: "Inventory", label: "Read stock levels, stock history and reorder suggestions" },
  { scope: "inventory:write", group: "Inventory", label: "Receive, count, transfer and adjust stock" },
  { scope: "supplies:write", group: "Inventory", label: "Log (and take back) supplies used on a visit" },
  { scope: "purchasing:read", group: "Inventory", label: "Read suppliers and purchase orders" },
  { scope: "purchasing:write", group: "Inventory", label: "Manage suppliers and purchase orders" },
  { scope: "clients:read", group: "Clients", label: "Read clients' details, appointments, packages and memberships" },
  { scope: "clients:write", group: "Clients", label: "Create and update client details (not consent, notes or balances)" },
  { scope: "clients:consent", group: "Clients", label: "Change whether a client agrees to texts and emails", sensitive: true },
  { scope: "clients:balances", group: "Clients", label: "See clients' store credit balances" },
  { scope: "client-notes:read", group: "Clients", label: "Read private client notes (formulas, allergies, preferences)" },
  { scope: "client-notes:write", group: "Clients", label: "Add and pin client notes" },
  { scope: "client-notes:delete", group: "Clients", label: "Delete client notes" },
  { scope: "appointments:read", group: "Appointments", label: "Read appointments, classes, standing appointments and the waitlist" },
  { scope: "appointments:book", group: "Appointments", label: "Book new appointments and standing appointments" },
  { scope: "appointments:change", group: "Appointments", label: "Move, add services to, and change the status or notes of appointments; block time" },
  { scope: "appointments:cancel", group: "Appointments", label: "Cancel appointments and standing appointments, or remove a service from one" },
  { scope: "appointments:delete", group: "Appointments", label: "Remove blocked time" },
  { scope: "waitlist:write", group: "Appointments", label: "Add to and update the waitlist" },
  { scope: "classes:write", group: "Appointments", label: "Schedule and cancel classes and enrol clients" },
  { scope: "forms:read", group: "Forms", label: "Read forms and what clients submitted" },
  { scope: "forms:write", group: "Forms", label: "Create and change forms" },
  { scope: "forms:void", group: "Forms", label: "Void or reassign signed submissions", sensitive: true },
  { scope: "forms:delete", group: "Forms", label: "Delete forms" },
  { scope: "reviews:read", group: "Reviews", label: "Read client reviews" },
  { scope: "sales:read", group: "Sales", label: "Read sales and payments (taking payments is not in the API)" },
  { scope: "staff:read", group: "Team", label: "Read staff contact details, hours and time off" },
  { scope: "staff:write", group: "Team", label: "Add and change staff, hours, time off and the services they perform", sensitive: true },
  { scope: "time:read", group: "Team", label: "Read time clock entries" },
  { scope: "time:write", group: "Team", label: "Add time clock entries (they feed payroll)", sensitive: true },
  { scope: "time:delete", group: "Team", label: "Delete time clock entries", sensitive: true },
  { scope: "pay:read", group: "Team", label: "Read staff pay settings", sensitive: true },
  { scope: "pay:write", group: "Team", label: "Change staff pay settings", sensitive: true },
  { scope: "roles:read", group: "Team", label: "Read roles and permissions" },
  { scope: "roles:write", group: "Team", label: "Create and change roles and permissions", sensitive: true },
  { scope: "roles:delete", group: "Team", label: "Delete roles", sensitive: true },
  { scope: "marketing:read", group: "Marketing", label: "Read campaigns, promo codes and automations" },
  { scope: "marketing:write", group: "Marketing", label: "Draft campaigns, create promo codes and build automations (nothing is sent)" },
  { scope: "campaigns:send", group: "Marketing", label: "Send campaigns and switch automations on", sensitive: true },
  { scope: "marketing:delete", group: "Marketing", label: "Delete campaigns and automations" },
  { scope: "messages:read", group: "Messages", label: "Read texts and emails sent to clients, and replies from them" },
  { scope: "messages:write", group: "Messages", label: "Reply to a client by text", sensitive: true },
  { scope: "messages:resend", group: "Messages", label: "Resend a message that failed to send", sensitive: true },
  { scope: "settings:read", group: "Settings", label: "Read business profile, booking rules, store, loyalty and wording settings" },
  { scope: "settings:write", group: "Settings", label: "Change business profile, locations, text wording, review and refund-reason settings" },
  { scope: "policies:write", group: "Settings", label: "Change booking rules, fees and deposits, loyalty and the online store", sensitive: true },
  { scope: "settings:delete", group: "Settings", label: "Delete a location", sensitive: true },
] as const satisfies readonly { scope: string; group: string; label: string; sensitive?: boolean }[];

export type ApiScope = (typeof API_SCOPES)[number]["scope"];

export const API_SCOPE_NAMES: readonly string[] = API_SCOPES.map((s) => s.scope);

export function isApiScope(x: unknown): x is ApiScope {
  return typeof x === "string" && API_SCOPE_NAMES.includes(x);
}

/** A key holds exactly what it was given: no scope implies another. Unknown scopes grant nothing. */
export function hasScope(granted: readonly string[], needed: ApiScope): boolean {
  return granted.includes(needed);
}

/**
 * Keys made before the finer scopes (scope_version 1) were given the old, coarser ones, where `x:write` also read `x:read` and one scope covered
 * several jobs. Each old scope expands to everything it used to allow, so no existing key loses a thing. `pricing:write` is added where an old
 * scope could already send a price field; it opens no route by itself, because every price-bearing route also needs its own scope.
 */
const R = (...s: ApiScope[]) => s;
export const LEGACY_SCOPES: Record<string, ApiScope[]> = {
  "catalog:read": R("catalog:read"),
  "catalog:write": R("catalog:read", "catalog:write", "pricing:write", "catalog:delete"),
  "inventory:read": R("inventory:read", "purchasing:read"),
  "inventory:write": R("inventory:read", "inventory:write", "supplies:write", "purchasing:read", "purchasing:write"),
  "clients:read": R("clients:read", "clients:balances", "client-notes:read"),
  "clients:write": R("clients:read", "clients:balances", "client-notes:read", "clients:write", "clients:consent", "client-notes:write", "client-notes:delete"),
  "appointments:read": R("appointments:read"),
  "appointments:write": R("appointments:read", "appointments:book", "appointments:change", "appointments:cancel", "appointments:delete", "waitlist:write", "classes:write", "pricing:write"), // pricing: a class session could be created with its own price
  "forms:read": R("forms:read"),
  "forms:write": R("forms:read", "forms:write", "forms:void", "forms:delete"),
  "reviews:read": R("reviews:read"),
  "sales:read": R("sales:read"),
  "staff:read": R("staff:read", "time:read"),
  "staff:write": R("staff:read", "staff:write", "time:read", "time:write", "time:delete", "pricing:write"), // pricing: a stylist's own prices
  "pay:read": R("pay:read"),
  "pay:write": R("pay:read", "pay:write"),
  "roles:read": R("roles:read"),
  "roles:write": R("roles:read", "roles:write", "roles:delete"),
  "marketing:read": R("marketing:read"),
  "marketing:write": R("marketing:read", "marketing:write", "campaigns:send", "marketing:delete", "pricing:write"), // pricing: promo codes
  "messages:read": R("messages:read"),
  "messages:write": R("messages:read", "messages:write", "messages:resend"),
  "settings:read": R("settings:read"),
  "settings:write": R("settings:read", "settings:write", "policies:write", "settings:delete"),
};

/** The scopes a stored key really holds. Version 2 keys are taken as stored (known scopes only); version 1 keys are expanded. */
export function expandScopes(stored: readonly string[], version: number): ApiScope[] {
  if (version >= 2) return [...new Set(stored.filter(isApiScope))];
  return [...new Set(stored.flatMap((s) => (Object.hasOwn(LEGACY_SCOPES, s) ? LEGACY_SCOPES[s]! : [])))];
}

/**
 * The role permission someone needs before they may put a scope on a key (owners may grant every scope). A key acts with no person
 * behind it, so without this anyone who can manage the business could mint a key for payroll or roles their own role can't touch.
 */
const SCOPE_NEEDS: [prefix: string, action: string][] = [
  ["pay:", "payroll.view"],
  ["time:", "payroll.view"],
  ["roles:", "members.manage"],
  ["staff:write", "staff.manage"],
  ["client-notes:", "clients.notes"],
  ["clients:read", "clients.read"],
  ["clients:balances", "clients.balances"],
  ["clients:", "clients.write"],
  ["forms:read", "clients.notes"],
  ["forms:", "clients.write"],
  ["messages:read", "clients.messages"],
  ["messages:", "clients.write"],
  ["marketing:", "clients.write"],
  ["campaigns:", "clients.write"],
  ["appointments:read", "appointments.read.any"],
  ["appointments:", "appointments.write.any"],
  ["waitlist:", "appointments.write.any"],
  ["classes:", "appointments.write.any"],
  ["sales:", "reports.view"],
  ["catalog:", "services.manage"],
  ["pricing:", "services.manage"],
  ["inventory:", "inventory.manage"],
  ["purchasing:", "inventory.manage"],
  ["supplies:", "inventory.log"],
];

/** Scopes in `scopes` that a person with these role permissions may not grant. */
export function scopesBeyond(scopes: readonly string[], permissions: { has(a: string): boolean }, isOwner: boolean): string[] {
  if (isOwner) return [];
  return scopes.filter((s) => {
    const need = SCOPE_NEEDS.find(([prefix]) => s.startsWith(prefix))?.[1];
    return need ? !permissions.has(need) : false;
  });
}

export const API_KEY_PREFIX = "ab_live_";

/** Requests per minute a key may make unless it sets its own. */
export const DEFAULT_RATE_LIMIT_PER_MIN = 120;
export const RATE_LIMIT_CHOICES = [30, 60, 120, 300, 600] as const;

/** Whether `ip` is allowed by a key's list: an empty list allows any address; entries are exact addresses or IPv4 ranges (203.0.113.0/24). */
export function ipAllowed(list: readonly string[], ip: string): boolean {
  if (!list.length) return true;
  return list.some((entry) => {
    const [base, bits] = entry.split("/");
    if (bits === undefined) return base === ip;
    const a = ipv4ToInt(base!);
    const b = ipv4ToInt(ip);
    const n = Number(bits);
    if (a === null || b === null || !Number.isInteger(n) || n < 0 || n > 32) return false;
    if (n === 0) return true;
    const mask = (0xffffffff << (32 - n)) >>> 0;
    return ((a & mask) >>> 0) === ((b & mask) >>> 0);
  });
}

/** Validate one allowlist entry as typed in the key form: an IPv4/IPv6 address or an IPv4 range. */
export function isValidIpEntry(entry: string): boolean {
  const pieces = entry.split("/");
  if (pieces.length > 2) return false;
  const [base, bits] = pieces;
  if (bits !== undefined) {
    const n = Number(bits);
    return ipv4ToInt(base!) !== null && /^\d{1,2}$/.test(bits) && n >= 0 && n <= 32;
  }
  return ipv4ToInt(base!) !== null || /^[0-9a-f:]+$/i.test(base!) && base!.includes(":") && base!.length <= 45;
}

function ipv4ToInt(ip: string): number | null {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip);
  if (!m) return null;
  const parts = m.slice(1).map(Number);
  if (parts.some((p) => p > 255)) return null;
  return (((parts[0]! << 24) | (parts[1]! << 16) | (parts[2]! << 8) | parts[3]!) >>> 0);
}
