import type { TenantWithBill } from "./tenants";

export const STATUS_FILTERS = [
  ["all", "All"],
  ["paying", "Paying"],
  ["trial", "On trial"],
  ["trial_ending", "Trial ending (7 days)"],
  ["attention", "Payment problems"],
  ["inactive", "No bookings in 30 days"],
  ["not_onboarded", "Not set up"],
  ["comped", "Comped"],
  ["suspended", "Suspended"],
] as const;
export type StatusFilter = (typeof STATUS_FILTERS)[number][0];

export const SORTS = [
  ["created", "Newest"],
  ["name", "Name"],
  ["estimate", "Est. / month"],
  ["locations", "Locations"],
  ["staff", "Staff"],
  ["clients", "Clients"],
  ["texts", "Texts 30d"],
  ["activity", "Last booking"],
] as const;
export type SortKey = (typeof SORTS)[number][0];

export type ListQuery = { q: string; status: StatusFilter; sort: SortKey; dir: "asc" | "desc" };

export function parseQuery(sp: Record<string, string | string[] | undefined>): ListQuery {
  const one = (k: string) => (Array.isArray(sp[k]) ? sp[k]![0] : sp[k]) ?? "";
  const status = STATUS_FILTERS.some(([k]) => k === one("status")) ? (one("status") as StatusFilter) : "all";
  const sort = SORTS.some(([k]) => k === one("sort")) ? (one("sort") as SortKey) : "created";
  const dir = one("dir") === "asc" ? "asc" : one("dir") === "desc" ? "desc" : sort === "name" ? "asc" : "desc";
  return { q: one("q").trim().slice(0, 100), status, sort, dir };
}

const DAY = 86_400_000;

export function matchesStatus(t: TenantWithBill, status: StatusFilter, now = Date.now()): boolean {
  switch (status) {
    case "all": return true;
    case "paying": return t.subscriptionStatus === "active";
    case "trial": return t.subscriptionStatus === "trialing" || (t.plan === "trial" && t.subscriptionStatus === "none");
    case "trial_ending": return !!t.trialEndsAt && t.trialEndsAt.getTime() > now && t.trialEndsAt.getTime() - now <= 7 * DAY;
    case "attention": return t.subscriptionStatus === "past_due" || t.subscriptionStatus === "unpaid";
    case "inactive": return t.appointments30d === 0;
    case "not_onboarded": return !t.onboarded;
    case "comped": return t.comped;
    case "suspended": return !!t.suspendedAt;
  }
}

function sortValue(t: TenantWithBill, k: SortKey): number | string {
  switch (k) {
    case "created": return t.createdAt.getTime();
    case "name": return t.name.toLowerCase();
    case "estimate": return t.bill.totalCents;
    case "locations": return t.locations;
    case "staff": return t.activeStaff;
    case "clients": return t.clients;
    case "texts": return t.sms30d;
    case "activity": return t.lastAppointmentAt?.getTime() ?? 0;
  }
}

export function applyQuery(tenants: TenantWithBill[], q: ListQuery, now = Date.now()): TenantWithBill[] {
  const needle = q.q.toLowerCase();
  const out = tenants.filter((t) => matchesStatus(t, q.status, now) && (!needle || [t.name, t.slug, t.ownerEmail ?? ""].some((s) => s.toLowerCase().includes(needle))));
  out.sort((a, b) => {
    const x = sortValue(a, q.sort);
    const y = sortValue(b, q.sort);
    const c = x < y ? -1 : x > y ? 1 : 0;
    return q.dir === "asc" ? c : -c;
  });
  return out;
}

export function csvCell(v: unknown): string {
  let s = v instanceof Date ? v.toISOString() : v == null ? "" : String(v);
  // Spreadsheet formula injection: a cell starting with these is evaluated by Excel/Sheets.
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(rows: unknown[][]): string {
  return rows.map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
}
