import { can } from "@angelic/core";
import { appointmentAccess } from "./appointment-access";

/** What `can` accepts: a resolved permission set, or a built-in role key as a fallback. */
type Subject = Parameters<typeof can>[0];

/**
 * Small "who sees what" rules that several pages share, kept here so a page and its nav entry (and a test) agree. Each one is a
 * permission check, never a role name. Phase 1 of PERMISSIONS-PLAN-2026-10-18.md gave each of these its own permission.
 */

/** The Gift cards page: balances and masked codes. */
export const canOpenGiftCards = (permissions: Subject) => can(permissions, "giftcards.view");
/** Full codes are for whoever issues cards; a reader sees enough to recognise one. */
export const canSeeGiftCardCodes = (permissions: Subject) => can(permissions, "giftcards.issue");
/** "••••1234": the last four characters, for receipts, tickets and the log. */
export const maskCode = (code: string) => `••••${code.slice(-4)}`;

/** A client's phone, email, address and birthday, wherever a client is shown (list, profile, appointment, hover card, roster, search, mobile). */
export const canSeeClientContact = (permissions: Subject) => can(permissions, "clients.contact");
/** Lifetime spend, spend per visit and tips on the client list and profile. */
export const canSeeClientSpend = (permissions: Subject) => can(permissions, "clients.spend");
/** Colleagues' weekly hours, days worked and time off: the staff list's days, Staff hours, the time-off list. */
export const canSeeStaffSchedules = (permissions: Subject) => can(permissions, "staff.schedules.view");
/** Prices on the menu, the hover card and class seats. */
export const canSeePrices = (permissions: Subject) => can(permissions, "catalog.prices");
/** Product cost and margins, and the product export (which carries costs). */
export const canSeeCosts = (permissions: Subject) => can(permissions, "catalog.costs");
/** Stock counts and the team's supply-usage list. */
export const canSeeStock = (permissions: Subject) => can(permissions, "inventory.view");
/** Every ticket, or only the ones they are credited on. Taking payments alone works like "own": the ticket they ring up is theirs. */
export const canSeeAllSales = (permissions: Subject) => can(permissions, "sales.view.all");
export const salesScope = (permissions: Subject): "all" | "own" | null =>
  can(permissions, "sales.view.all") ? "all" : can(permissions, "sales.view.own") || can(permissions, "checkout.take") ? "own" : null;
/** Reviews: every review, only the reviews of visits they performed, or none. */
export const canSeeReviews = (permissions: Subject): "all" | "own" | null => (can(permissions, "reviews.view") ? "all" : can(permissions, "reviews.view.own") ? "own" : null);
/** The Sales page opens for whoever takes payments or may see tickets. */
export const canOpenSales = (permissions: Subject) => salesScope(permissions) !== null;

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

type ClientLike = { id: string; firstName: string; lastName: string | null; phone?: string | null; email?: string | null; notes?: string | null } & Record<string, unknown>;

/**
 * An appointment's client as the mobile app may see it: the name always; phone, email and everything else on the record only with
 * "See phone, email, address and birthday"; private notes only with "Read notes and forms". The visit's own notes (what the team wrote
 * about this appointment) stay with the appointment and are not touched here.
 */
export function clientForViewer<C extends ClientLike>(client: C | null, permissions: Subject): Partial<C> | null {
  if (!client) return null;
  if (!canSeeClientContact(permissions)) {
    const base = { id: client.id, firstName: client.firstName, lastName: client.lastName } as Partial<C>;
    return can(permissions, "clients.notes") && client.notes !== undefined ? ({ ...base, notes: client.notes } as Partial<C>) : base;
  }
  if (can(permissions, "clients.notes")) return client;
  const { notes: _notes, ...rest } = client;
  return rest as Partial<C>;
}
