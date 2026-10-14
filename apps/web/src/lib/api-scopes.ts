/** What an API key may do. A key carries a list of these; `x:write` implies `x:read`. Pure, shared by the API, the key form and the docs. */
export const API_SCOPES = [
  { scope: "catalog:read", label: "Read services, staff, hours, products, locations, packages and availability", write: false },
  { scope: "catalog:write", label: "Create and change services and products", write: true },
  { scope: "clients:read", label: "Read clients", write: false },
  { scope: "clients:write", label: "Create and update clients", write: true },
  { scope: "appointments:read", label: "Read appointments", write: false },
  { scope: "appointments:write", label: "Book, change and cancel appointments", write: true },
  { scope: "sales:read", label: "Read sales and payments", write: false },
  { scope: "inventory:read", label: "Read stock levels and stock history", write: false },
  { scope: "inventory:write", label: "Receive, adjust and write off stock", write: true },
  { scope: "reviews:read", label: "Read client reviews", write: false },
] as const;

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
