/** Matching a public visitor to an existing client record. Pure, so it is unit tested. */

/** Letters only, case and accents ignored, so "Mary-Ann " and "maryann", or "José" and "Jose", compare equal (any script). */
const nameKey = (x: string | null | undefined) => (x ?? "").toLowerCase().normalize("NFKD").replace(/\p{M}/gu, "").replace(/[^\p{L}]/gu, "");

/**
 * Does the typed name belong to this record? A phone or email alone is not proof of who someone is (a relative's phone, or a
 * stranger who knows a client's number), so an anonymous visitor is only attached to an existing client when the name matches too.
 * A record with no last name (common in imports) matches on first name.
 */
export function sameClientName(record: { firstName: string; lastName: string | null }, typed: { firstName: string; lastName?: string | null }): boolean {
  if (!nameKey(typed.firstName) || nameKey(record.firstName) !== nameKey(typed.firstName)) return false;
  return !nameKey(record.lastName) || nameKey(record.lastName) === nameKey(typed.lastName);
}
