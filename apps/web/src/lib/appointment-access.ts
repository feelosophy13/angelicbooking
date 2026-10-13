import { can, type Permissions } from "@angelic/core";

/**
 * Who may see or change an appointment. "any" permissions cover every appointment; "own" permissions cover appointments the person
 * themselves is booked on (a Provider). Returns which rule lets them in, or null.
 */
export function appointmentAccess(permissions: Permissions, mode: "read" | "write", myStaffId: string | null, itemStaffIds: string[]): "any" | "own" | null {
  if (can(permissions, mode === "read" ? "appointments.read.any" : "appointments.write.any")) return "any";
  if (can(permissions, mode === "read" ? "appointments.read.own" : "appointments.write.own") && myStaffId && itemStaffIds.includes(myStaffId)) return "own";
  return null;
}

/** A person who can see only their own appointments: no "any" permission, but an "own" one. */
export const seesOwnOnly = (permissions: Permissions) => !can(permissions, "appointments.read.any") && can(permissions, "appointments.read.own");
export const seesNoCalendar = (permissions: Permissions) => !can(permissions, "appointments.read.any") && !can(permissions, "appointments.read.own");
