import { can } from "@angelic/core";

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

/** The staff directory shows a co-worker's email and whether they have a login only to whoever manages staff or logins. */
export const canSeeStaffLogins = (permissions: Subject) => can(permissions, "staff.manage") || can(permissions, "members.manage");
