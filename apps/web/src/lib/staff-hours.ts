/** Pure helpers for the Staff hours page: who is listed, in what order, and how the month is laid out. */

export interface StaffLike { id: string; name: string; takesAppointments: boolean; sortOrder: number; role?: string | null }

/** Providers first in their booking-page order, then everyone else (front desk, managers) in theirs. */
export function orderStaff<T extends Pick<StaffLike, "name" | "takesAppointments" | "sortOrder">>(staff: T[]): T[] {
  const by = (a: T, b: T) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name);
  return [...staff.filter((s) => s.takesAppointments).sort(by), ...staff.filter((s) => !s.takesAppointments).sort(by)];
}

/**
 * The People filter (`?people=`): everyone, one of the business's login roles (Owner, Manager, Front desk, Provider, or a role the
 * business made), or the staff who have no login yet. Roles are the business's own list in its order; only roles somebody holds are offered.
 */
export type PeopleFilter = "" | "nologin" | `r:${string}`;
export interface RoleLike { key: string; name: string }
export interface StaffRoleLike { role?: string | null }

export function peopleOptions(staff: StaffRoleLike[], roles: RoleLike[]): { value: PeopleFilter; label: string }[] {
  const held = new Set(staff.map((s) => s.role).filter((r): r is string => !!r));
  return [
    { value: "", label: "Everyone" },
    ...roles.filter((r) => held.has(r.key)).map((r) => ({ value: `r:${r.key}` as const, label: r.name })),
    ...(staff.some((s) => !s.role) ? [{ value: "nologin" as const, label: "No login yet" }] : []),
  ];
}

/** The filter from the query string, or "" when it names nothing this business has. */
export function parsePeopleFilter(raw: string | undefined, staff: StaffRoleLike[], roles: RoleLike[]): PeopleFilter {
  const v = raw ?? "";
  return v && peopleOptions(staff, roles).some((o) => o.value === v) ? (v as PeopleFilter) : "";
}

export function matchesPeople(s: StaffRoleLike, filter: PeopleFilter): boolean {
  if (filter === "") return true;
  if (filter === "nologin") return !s.role;
  return s.role === filter.slice(2);
}

// ---- Month view

/** "2026-10-18" → "2026-10". */
export const monthOf = (isoDate: string) => isoDate.slice(0, 7);

/** "2026-10" moved by n months. */
export function shiftMonth(ym: string, n: number): string {
  const [y, m] = ym.split("-").map(Number);
  const dt = new Date(Date.UTC(y!, m! - 1 + n, 1));
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** Every date of the month, first to last. */
export function monthDates(ym: string): string[] {
  const [y, m] = ym.split("-").map(Number);
  const days = new Date(Date.UTC(y!, m!, 0)).getUTCDate();
  return Array.from({ length: days }, (_, i) => `${ym}-${String(i + 1).padStart(2, "0")}`);
}

/** Leading blanks so the 1st lands under its weekday in a Monday-first grid. */
export function monthLeadingBlanks(ym: string): number {
  return (new Date(ym + "-01T00:00:00Z").getUTCDay() + 6) % 7;
}

/** "October 2026". */
export const monthLabel = (ym: string) => new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(ym + "-01T00:00:00Z"));

/** Minutes from midnight as the short clock people write on a roster: 540 → "9", 570 → "9:30", 1440 → "12". */
export const clockShort = (min: number) => {
  const h = ((Math.floor(min / 60) + 11) % 12) + 1;
  const m = min % 60;
  return m ? `${h}:${String(m).padStart(2, "0")}` : String(h);
};

/** "9–5", "9:30–5:30"; several blocks are joined with a comma. */
export const hoursShort = (blocks: { start: number; end: number }[]) => blocks.map((b) => `${clockShort(b.start)}–${clockShort(b.end)}`).join(", ");
