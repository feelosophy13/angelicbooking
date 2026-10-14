import { can, type Action, type Permissions } from "@angelic/core";

/**
 * Who may do what to an appointment. Every kind of change has an "any" permission (Manager, Front desk) and an "own" one (a Provider):
 *   read    see it
 *   write   update it: status, notes, photos, checkout
 *   change  change the booking: add, remove or move services
 *   cancel  cancel it, charge no-show or late fees, end a standing series
 * "Any" covers every appointment. "Own" covers appointments the person is booked on, and only when their login is linked to a staff member.
 * The owner decides which "own" permissions a role has; none of the three beyond "write" is on for Provider by default.
 */
export type AppointmentMode = "read" | "write" | "change" | "cancel";
const ANY: Record<AppointmentMode, Action> = { read: "appointments.read.any", write: "appointments.write.any", change: "appointments.write.any", cancel: "appointments.write.any" };
const OWN: Record<AppointmentMode, Action> = { read: "appointments.read.own", write: "appointments.write.own", change: "appointments.change.own", cancel: "appointments.cancel.own" };

export function appointmentAccess(permissions: Permissions, mode: AppointmentMode, myStaffId: string | null, itemStaffIds: string[]): "any" | "own" | null {
  if (can(permissions, ANY[mode])) return "any";
  // Changing or cancelling something implies being allowed to see it.
  if (can(permissions, OWN[mode]) && can(permissions, OWN.read) && myStaffId && itemStaffIds.includes(myStaffId)) return "own";
  return null;
}

/** Creating a new appointment: anyone with "any" books for anyone; with "book on their own" they book on their own calendar only. */
export function bookingAccess(permissions: Permissions, myStaffId: string | null): "any" | "own" | null {
  if (can(permissions, "appointments.write.any")) return "any";
  if (can(permissions, "appointments.book.own") && myStaffId) return "own";
  return null;
}

/** A person who can see only their own appointments: no "any" permission, but an "own" one. */
export const seesOwnOnly = (permissions: Permissions) => !can(permissions, "appointments.read.any") && can(permissions, "appointments.read.own");
export const seesNoCalendar = (permissions: Permissions) => !can(permissions, "appointments.read.any") && !can(permissions, "appointments.read.own");
