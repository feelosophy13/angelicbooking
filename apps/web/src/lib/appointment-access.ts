import { APPOINTMENT_CAPABILITIES, can, type AppointmentCapability, type Permissions } from "@angelic/core";

/**
 * Who may do what to an appointment, driven by APPOINTMENT_CAPABILITIES in @angelic/core (see there for the list). A capability has an
 * "any" permission (Manager, Front desk: every appointment) and an "own" one (a Provider or any role the owner sets up: appointments they are
 * booked on, and only when their login is linked to a staff member). The owner decides which "own" permissions a role has.
 */
export type AppointmentMode = Exclude<AppointmentCapability, "book">;

/**
 * How far someone's access to one appointment reaches.
 *   any     every line of it (the "any" permission)
 *   own     every line is theirs: the whole appointment is theirs to update, change or cancel (as far as their "own" permissions go)
 *   shared  some lines are theirs and some are a colleague's: they may see it, and update, move or remove their own lines, but nothing
 *           that touches the colleague's lines (the visit's status, cancelling it, moving it as one)
 */
export type AppointmentAccess = "any" | "own" | "shared";

export function appointmentAccess(permissions: Permissions, mode: AppointmentMode, myStaffId: string | null, itemStaffIds: string[]): AppointmentAccess | null {
  const cap = APPOINTMENT_CAPABILITIES[mode];
  if (can(permissions, cap.any)) return "any";
  // Acting on an appointment implies being allowed to see it.
  if (!can(permissions, cap.own) || !can(permissions, APPOINTMENT_CAPABILITIES.read.own) || !myStaffId || !itemStaffIds.includes(myStaffId)) return null;
  if (itemStaffIds.every((id) => id === myStaffId)) return "own";
  // Booked on it alongside a colleague: cancelling takes their lines with it, so it needs the "any" permission.
  return mode === "cancel" ? null : "shared";
}

/** Whether this access reaches the whole appointment: its status (which every line follows), cancelling it, moving it as one. */
export const coversWholeAppointment = (access: AppointmentAccess | null) => access === "any" || access === "own";
/** Whether this access reaches one line of the appointment (a service booked with `lineStaffId`). */
export const coversLine = (access: AppointmentAccess | null, myStaffId: string | null, lineStaffId: string | null | undefined) =>
  access === "any" || access === "own" || (access === "shared" && !!myStaffId && lineStaffId === myStaffId);

/** Creating something new on a calendar (a booking, or a block of time): anyone with "any" for anyone's, "own" only for their own calendar. */
export function creationAccess(permissions: Permissions, kind: "book" | "block", myStaffId: string | null): "any" | "own" | null {
  const cap = APPOINTMENT_CAPABILITIES[kind];
  if (can(permissions, cap.any)) return "any";
  if (can(permissions, cap.own) && myStaffId) return "own";
  return null;
}
export const bookingAccess = (permissions: Permissions, myStaffId: string | null) => creationAccess(permissions, "book", myStaffId);
export const blockingAccess = (permissions: Permissions, myStaffId: string | null) => creationAccess(permissions, "block", myStaffId);

/** A person who can see only their own appointments: no "any" permission, but an "own" one. */
export const seesOwnOnly = (permissions: Permissions) => !can(permissions, "appointments.read.any") && can(permissions, "appointments.read.own");
export const seesNoCalendar = (permissions: Permissions) => !can(permissions, "appointments.read.any") && !can(permissions, "appointments.read.own");
