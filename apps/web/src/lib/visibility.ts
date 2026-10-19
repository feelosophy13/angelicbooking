import { can } from "@angelic/core";
import { appointmentAccess } from "./appointment-access";

/** What `can` accepts: a resolved permission set, or a built-in role key as a fallback. */
type Subject = Parameters<typeof can>[0];

/**
 * Small "who sees what" rules that several pages share, kept here so a page and its nav entry (and a test) agree. Each one is a
 * permission check, never a role name.
 */

/** The Gift cards page: whoever issues cards, or reads the money reports (the outstanding balance is a liability). */
export const canOpenGiftCards = (permissions: Subject) => can(permissions, "giftcards.issue") || can(permissions, "reports.view");
/** Full codes are for whoever issues cards; a reports reader sees enough to recognise one. */
export const canSeeGiftCardCodes = (permissions: Subject) => can(permissions, "giftcards.issue");
/** "••••1234": the last four characters, for receipts, tickets and the log. */
export const maskCode = (code: string) => `••••${code.slice(-4)}`;

/** A client's phone and email, wherever a list prints them (a class roster, a mobile appointment). */
export const canSeeClientContact = (permissions: Subject) => can(permissions, "clients.read");

/** A class session is an appointment on its instructor's calendar: everyone with "see every calendar" sees it, an own-calendar role only their own classes. */
export const canSeeClassSession = (permissions: Subject, myStaffId: string | null, instructorStaffId: string) =>
  typeof permissions !== "string" && !!permissions && appointmentAccess(permissions, "read", myStaffId, [instructorStaffId]) !== null;

/** The staff directory shows a co-worker's email and whether they have a login only to whoever manages staff or logins. */
export const canSeeStaffLogins = (permissions: Subject) => can(permissions, "staff.manage") || can(permissions, "members.manage");

/**
 * Whether a member may view a private uploaded file (/api/files/<id>), by what the file is: a client's profile photo follows "See visit
 * photos", a signature or form attachment follows "Read notes and forms", and a visit photo follows the appointment it belongs to (anyone
 * who may open that appointment). `visit` carries whose lines that appointment has; an orphaned visit photo opens only for "any" roles.
 */
export function canViewPrivateFile(kind: string, permissions: Subject, me: { staffId: string | null }, visit?: { staffIds: string[] } | null): boolean {
  switch (kind) {
    case "client":
      return can(permissions, "clients.photos");
    case "form":
    case "signature":
      return can(permissions, "clients.notes");
    case "visit":
      return typeof permissions !== "string" && !!permissions && appointmentAccess(permissions, "read", me.staffId, visit?.staffIds ?? []) !== null;
    default:
      return false;
  }
}
