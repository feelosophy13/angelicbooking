/** Pure helpers for the Staff hours page: who is listed, in what order, and how the month is laid out. */

export interface StaffLike { id: string; name: string; takesAppointments: boolean; sortOrder: number; position?: string | null }

/** Providers first in their booking-page order, then everyone else (front desk, managers) in theirs. */
export function orderStaff<T extends Pick<StaffLike, "name" | "takesAppointments" | "sortOrder">>(staff: T[]): T[] {
  const by = (a: T, b: T) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name);
  return [...staff.filter((s) => s.takesAppointments).sort(by), ...staff.filter((s) => !s.takesAppointments).sort(by)];
}
