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

export const titleCase = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase().replace(/(^|[\s\-/&(])(\p{L})/gu, (m, pre, ch) => pre + ch.toUpperCase());

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
