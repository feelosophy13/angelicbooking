/**
 * Guests on one online booking ("Book for me and others"): what each guest picked, kept in the booking page's URL as `g`.
 * Each guest is `service.staff.timing[.extra_extra]` (timing `t` together, `a` after), guests joined by `~`. Ids are uuids, which never
 * hold `.`, `_` or `~`.
 */
export const MAX_GUESTS = 3;

/** "together": starts when the booker starts. "after": starts as the person before them finishes. */
export type GuestTiming = "together" | "after";

export interface GuestChoice {
  serviceId: string;
  /** A provider id, or "any" for whoever is free. */
  staffId: string;
  timing: GuestTiming;
  /** Add-ons and further services for this guest, with their own provider, back to back after their first service. */
  extraServiceIds: string[];
}

const ID = /^[A-Za-z0-9-]{1,64}$/;

export function encodeGuests(guests: GuestChoice[]): string {
  return guests
    .slice(0, MAX_GUESTS)
    .map((g) => [g.serviceId, g.staffId, g.timing === "after" ? "a" : "t", ...(g.extraServiceIds.length ? [g.extraServiceIds.join("_")] : [])].join("."))
    .join("~");
}

/** Read guests back from the URL or a form; anything malformed is dropped, never guessed at. */
export function decodeGuests(raw: string | null | undefined): GuestChoice[] {
  if (!raw) return [];
  const out: GuestChoice[] = [];
  for (const part of raw.split("~").slice(0, MAX_GUESTS)) {
    const [serviceId, staffId, t, extras] = part.split(".");
    if (!serviceId || !ID.test(serviceId) || !staffId || !(staffId === "any" || ID.test(staffId)) || (t !== "a" && t !== "t")) continue;
    const extraServiceIds = [...new Set((extras ?? "").split("_").filter((x) => ID.test(x) && x !== serviceId))].slice(0, 4);
    out.push({ serviceId, staffId, timing: t === "a" ? "after" : "together", extraServiceIds });
  }
  return out;
}

/** Who a guest is to the booker, asked on the form. Family links the new client to the booker (a child gets messages at the parent's). */
export const GUEST_RELATIONS = [
  { value: "friend", label: "A friend" },
  { value: "child", label: "My child" },
  { value: "partner", label: "My partner" },
  { value: "parent", label: "My parent" },
] as const;
export type GuestRelation = (typeof GUEST_RELATIONS)[number]["value"];

/** The name, contact and relation typed for one guest on the booking form (or a family member picked by a signed-in client). */
export interface GuestDetails {
  firstName: string;
  lastName: string;
  phone: string | null;
  email: string | null;
  relation: GuestRelation;
  /** A signed-in client booking for one of their linked people. */
  familyClientId?: string | null;
}

/** The guest fields of a booking form, by their numbered names (guest0FirstName…), for as many guests as were planned. */
export function guestDetailsFrom(raw: Record<string, unknown>, count: number): GuestDetails[] | { error: string } {
  const out: GuestDetails[] = [];
  for (let i = 0; i < count; i++) {
    const s = (k: string) => String(raw[`guest${i}${k}`] ?? "").trim();
    const familyClientId = s("Family");
    const firstName = s("FirstName").slice(0, 60);
    if (!familyClientId && !firstName) return { error: `Enter a first name for guest ${i + 1}.` };
    const email = s("Email").slice(0, 200) || null;
    if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { error: `Enter a valid email for guest ${i + 1}, or leave it blank.` };
    const rel = s("Relation");
    out.push({
      firstName,
      lastName: s("LastName").slice(0, 60),
      phone: s("Phone").slice(0, 30) || null,
      email,
      relation: (GUEST_RELATIONS.some((r) => r.value === rel) ? rel : "friend") as GuestRelation,
      familyClientId: familyClientId && ID.test(familyClientId) ? familyClientId : null,
    });
  }
  return out;
}
