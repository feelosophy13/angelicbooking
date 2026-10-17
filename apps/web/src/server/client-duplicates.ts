/**
 * Likely duplicate clients: someone already on file in this business with the same phone (last ten digits, so "(555) 555-0177" and
 * "+15555550177" match), the same email (any case), or the same first and last name (any case). Used to warn staff before they add a
 * second record for the same person. Runs inside withTenant, so RLS keeps it to the one business.
 */
import { and, ne, or, sql, type SQL } from "drizzle-orm";
import { schema, type TenantDb } from "@angelic/db";
import { phoneTail } from "@/server/consent";

export type DuplicateReason = "phone" | "email" | "name";

export interface DuplicateMatch {
  id: string;
  firstName: string;
  lastName: string;
  phone: string | null;
  email: string | null;
  reasons: DuplicateReason[];
}

export interface DuplicateProbe {
  /** The client itself, left out of the results (when checking an existing record). */
  id?: string | null;
  firstName: string;
  lastName?: string | null;
  phone?: string | null;
  email?: string | null;
}

const c = schema.clients;

export async function likelyDuplicates(tx: TenantDb, probe: DuplicateProbe, limit = 3): Promise<DuplicateMatch[]> {
  const tail = phoneTail(probe.phone);
  const email = probe.email?.trim().toLowerCase() || "";
  const first = probe.firstName.trim().toLowerCase();
  const last = (probe.lastName ?? "").trim().toLowerCase();
  const conds: SQL[] = [];
  if (tail) conds.push(sql`right(regexp_replace(coalesce(${c.phone}, ''), '\\D', '', 'g'), 10) = ${tail}`);
  if (email) conds.push(sql`lower(${c.email}) = ${email}`);
  // A first name alone ("Ana") is too common to flag; both names have to match.
  if (first && last) conds.push(sql`lower(${c.firstName}) = ${first} and lower(${c.lastName}) = ${last}`);
  if (!conds.length) return [];
  const rows = await tx
    .select({ id: c.id, firstName: c.firstName, lastName: c.lastName, phone: c.phone, email: c.email })
    .from(c)
    .where(and(or(...conds), probe.id ? ne(c.id, probe.id) : undefined))
    .orderBy(c.createdAt)
    .limit(25);
  const matches = rows.map((r) => {
    const reasons: DuplicateReason[] = [];
    if (tail && phoneTail(r.phone) === tail) reasons.push("phone");
    if (email && r.email?.trim().toLowerCase() === email) reasons.push("email");
    if (first && last && r.firstName.trim().toLowerCase() === first && r.lastName.trim().toLowerCase() === last) reasons.push("name");
    return { ...r, reasons };
  });
  // Phone and email are stronger signals than a shared name; more reasons first.
  const weight = (m: DuplicateMatch) => m.reasons.reduce((s, r) => s + (r === "name" ? 1 : 2), 0);
  return matches.sort((a, b) => weight(b) - weight(a)).slice(0, limit);
}

/** "•••-•••-0177": enough to recognise a number without showing all of it. */
export function maskPhone(phone: string | null | undefined): string | null {
  const d = (phone ?? "").replace(/\D/g, "");
  return d.length >= 4 ? `•••-•••-${d.slice(-4)}` : null;
}

/** "a•••@example.com". */
export function maskEmail(email: string | null | undefined): string | null {
  if (!email) return null;
  const [user, domain] = email.split("@");
  if (!user || !domain) return null;
  return `${user[0]}•••@${domain}`;
}
