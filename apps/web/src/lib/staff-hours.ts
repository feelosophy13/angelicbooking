/** Pure helpers for the Staff hours page: who is listed, in what order, and how the month is laid out. */

export interface StaffLike { id: string; name: string; takesAppointments: boolean; sortOrder: number; position?: string | null }

/** Providers first in their booking-page order, then everyone else (front desk, managers) in theirs. */
export function orderStaff<T extends Pick<StaffLike, "name" | "takesAppointments" | "sortOrder">>(staff: T[]): T[] {
  const by = (a: T, b: T) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name);
  return [...staff.filter((s) => s.takesAppointments).sort(by), ...staff.filter((s) => !s.takesAppointments).sort(by)];
}

/**
 * The People filter (`?people=`): everyone, providers, front desk and other staff, or one position.
 * Positions are free text, so the per-position choices are keyed by the lower-cased trimmed text ("p:front desk")
 * and shown title-cased; two spellings that differ only in case are one choice.
 */
export type PeopleFilter = "" | "providers" | "other" | `p:${string}`;

/** "lash artist" → "Lash Artist"; a word already in capitals ("PMU", "RN") stays as written. */
export const titleCase = (s: string) =>
  s
    .trim()
    .replace(/\s+/g, " ")
    .split(" ")
    .map((w) => (w.length > 1 && w === w.toUpperCase() && /\p{L}/u.test(w) ? w : w.toLowerCase().replace(/(^|[\-/&(])(\p{L})/gu, (m, pre, ch) => pre + ch.toUpperCase())))
    .join(" ");

export function peopleOptions(staff: Pick<StaffLike, "position">[]): { value: PeopleFilter; label: string }[] {
  const positions = new Map<string, string>();
  for (const s of staff) {
    const key = (s.position ?? "").trim().replace(/\s+/g, " ").toLowerCase();
    if (key && !positions.has(key)) positions.set(key, titleCase(s.position!));
  }
  return [
    { value: "", label: "Everyone" },
    { value: "providers", label: "Providers" },
    { value: "other", label: "Front desk & other staff" },
    ...[...positions.entries()].sort((a, b) => a[1].localeCompare(b[1])).map(([key, label]) => ({ value: `p:${key}` as const, label })),
  ];
}

/** The filter from the query string, or "" when it names nothing this business has. */
export function parsePeopleFilter(raw: string | undefined, staff: Pick<StaffLike, "position">[]): PeopleFilter {
  const v = raw ?? "";
  if (v === "providers" || v === "other") return v;
  if (v.startsWith("p:") && peopleOptions(staff).some((o) => o.value === v)) return v as PeopleFilter;
  return "";
}

export function matchesPeople(s: Pick<StaffLike, "takesAppointments" | "position">, filter: PeopleFilter): boolean {
  if (filter === "") return true;
  if (filter === "providers") return s.takesAppointments;
  if (filter === "other") return !s.takesAppointments;
  return (s.position ?? "").trim().replace(/\s+/g, " ").toLowerCase() === filter.slice(2);
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
