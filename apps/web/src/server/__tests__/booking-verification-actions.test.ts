// The booking page's server action with booking codes on: no code, no booking; a valid code books onto the client who owns the phone.
import "../../../../../packages/db/src/env";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, set: () => undefined }), headers: async () => new Headers({ host: "kit.test" }) }));
vi.mock("next/server", async (orig) => ({ ...(await orig<typeof import("next/server")>()), after: () => undefined }));
vi.mock("next/navigation", async (orig) => ({ ...(await orig<typeof import("next/navigation")>()), redirect: (url: string) => { throw Object.assign(new Error("NEXT_REDIRECT"), { url }); } }));
import { eq } from "drizzle-orm";
import { db, schema, withTenant } from "@angelic/db";
import { instantToISODate, zonedToInstant, addDays } from "@angelic/core";
import { bookOnline } from "@/app/book/[slug]/actions";
import { encodeVerifiedContact } from "@/lib/client-session";
import { reachable, setupKit } from "@/lib/__tests__/api-test-kit";

const up = await reachable();
const PHONE = "+15715550177";

describe.skipIf(!up)("booking page with booking codes on", () => {
  let kit: Awaited<ReturnType<typeof setupKit>>;
  let staffId: string;
  let serviceId: string;
  let ownerId: string;
  let tz = "America/New_York";
  beforeAll(async () => {
    kit = await setupKit([]);
    await db.update(schema.businesses).set({ onlineBookingEnabled: true, verifyBookingContact: true, publishRequiresVerified: false }).where(eq(schema.businesses.id, kit.A));
    tz = (await db.query.businesses.findFirst({ where: eq(schema.businesses.id, kit.A) }))!.timezone;
    await withTenant(kit.A, async (tx) => {
      const [st] = await tx.insert(schema.staff).values({ businessId: kit.A, displayName: "Sam" }).returning();
      staffId = st!.id;
      for (let weekday = 0; weekday < 7; weekday++) await tx.insert(schema.staffSchedules).values({ businessId: kit.A, staffId, weekday, startTime: "09:00", endTime: "17:00" });
      const [sv] = await tx.insert(schema.services).values({ businessId: kit.A, name: "Brow wax", durationMin: 30, priceCents: 1500 }).returning();
      serviceId = sv!.id;
      const [owner] = await tx.insert(schema.clients).values({ businessId: kit.A, firstName: "Jennifer", lastName: "Smith", phone: PHONE, email: "jen2@example.test" }).returning();
      ownerId = owner!.id;
    });
  });
  afterAll(async () => {
    await kit?.teardown();
  });

  const form = (hh: number, extra: Record<string, string> = {}) => {
    const startAt = zonedToInstant(addDays(instantToISODate(new Date(), tz), 10), `${hh}:00`, tz);
    const fd = new FormData();
    for (const [k, v] of Object.entries({ slug: kit.A, serviceId, staffId, startAt: startAt.toISOString(), firstName: "Jen", lastName: "Smith", phone: "(571) 555-0177", email: "jen2@example.test", notes: "", ...extra })) fd.set(k, v);
    return fd;
  };

  it("refuses a booking without a code", async () => {
    expect(await bookOnline(undefined, form(10))).toEqual({ error: expect.stringMatching(/code/) });
    expect(await withTenant(kit.A, (tx) => tx.select().from(schema.appointments))).toEqual([]);
  });

  it("books with a valid code onto the client who owns the phone, though the name was typed differently", async () => {
    const token = encodeVerifiedContact(kit.A, PHONE);
    const out = await bookOnline(undefined, form(11, { verifyToken: token })).catch((e: Error & { url?: string }) => e);
    expect((out as { url?: string }).url).toMatch(/\/confirmed\//);
    const appts = await withTenant(kit.A, (tx) => tx.select().from(schema.appointments));
    expect(appts.map((a) => a.clientId)).toEqual([ownerId]);
  });

  it("refuses a code proven for another number", async () => {
    const out = await bookOnline(undefined, form(12, { verifyToken: encodeVerifiedContact(kit.A, "+15715550188") }));
    expect(out).toEqual({ error: expect.stringMatching(/code/) });
  });
});
