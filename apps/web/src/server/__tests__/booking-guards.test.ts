/**
 * Integration test for the booking guards: the waitlist only takes bookable services inside the booking window and caps open entries,
 * a desk booking or a drag can't land on a class the provider is teaching, and a standing appointment at a custom time (off the slot
 * grid) still books. Needs Postgres at DATABASE_URL (the app role, RLS forced); skipped otherwise.
 */
import "../../../../../packages/db/src/env";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { db, schema, withTenant } from "@angelic/db";
import { instantToISODate, zonedToInstant } from "@angelic/core";
import { shiftISODate } from "@/lib/utils";
import { joinWaitlist, WAITLIST_CAP } from "@/server/public-booking";
import { bookAppointment, rescheduleService } from "@/server/booking";
import { createSeries } from "@/server/series";
import { reachable, setupKit } from "@/lib/__tests__/api-test-kit";

vi.mock("next/server", async (orig) => ({ ...(await orig<typeof import("next/server")>()), after: () => undefined }));

const up = await reachable();

describe.skipIf(!up)("booking guards", () => {
  let kit: Awaited<ReturnType<typeof setupKit>>;
  let userId: string;
  let staffId: string;
  let cut: string;
  let hidden: string;
  let clientId: string;
  let tz: string;
  const business = async () => (await db.query.businesses.findFirst({ where: eq(schema.businesses.id, kit.A) }))!;
  // A day a few days out, at a local time.
  const at = (daysOut: number, hhmm: string) => zonedToInstant(shiftISODate(instantToISODate(new Date(), tz), daysOut), hhmm, tz);
  beforeAll(async () => {
    kit = await setupKit([]);
    userId = `u_${kit.A}`;
    await db.insert(schema.user).values({ id: userId, name: "Tester", email: `${userId}@example.test`, emailVerified: true });
    await withTenant(kit.A, async (tx) => {
      await tx.update(schema.businesses).set({ onlineBookingEnabled: true, maxAdvanceDays: 30 }).where(eq(schema.businesses.id, kit.A));
      const [s] = await tx.insert(schema.staff).values({ businessId: kit.A, displayName: "Sam" }).returning({ id: schema.staff.id });
      staffId = s!.id;
      await tx.insert(schema.staffSchedules).values([0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ businessId: kit.A, staffId, weekday, startTime: "08:00", endTime: "20:00" })));
      cut = (await tx.insert(schema.services).values({ businessId: kit.A, name: "Cut", durationMin: 30, priceCents: 5000, bookableOnline: true }).returning())[0]!.id;
      hidden = (await tx.insert(schema.services).values({ businessId: kit.A, name: "Private", durationMin: 30, priceCents: 5000, bookableOnline: false }).returning())[0]!.id;
      clientId = (await tx.insert(schema.clients).values({ businessId: kit.A, firstName: "Ana", phone: "+15550001111" }).returning())[0]!.id;
    });
    tz = (await business()).timezone;
  });
  afterAll(async () => {
    await kit?.teardown();
    if (userId) await db.delete(schema.user).where(eq(schema.user.id, userId));
  });

  it("takes waitlist entries only for bookable services inside the window, and caps them", async () => {
    const b = await business();
    const today = instantToISODate(new Date(), tz);
    const who = { staffId: null, firstName: "Wren", lastName: "Lee", email: null, phone: "+15550002222", notes: null };
    await expect(joinWaitlist(b, { ...who, serviceId: hidden, date: shiftISODate(today, 2) })).rejects.toThrow(/can't be booked online/);
    await expect(joinWaitlist(b, { ...who, serviceId: cut, date: shiftISODate(today, -1) })).rejects.toThrow(/booking window/);
    await expect(joinWaitlist(b, { ...who, serviceId: cut, date: shiftISODate(today, 90) })).rejects.toThrow(/booking window/);
    for (let i = 1; i <= WAITLIST_CAP; i++) await joinWaitlist(b, { ...who, serviceId: cut, date: shiftISODate(today, i) });
    await joinWaitlist(b, { ...who, serviceId: cut, date: shiftISODate(today, 1) }); // same day again: no new row
    await expect(joinWaitlist(b, { ...who, serviceId: cut, date: shiftISODate(today, WAITLIST_CAP + 1) })).rejects.toThrow(/already on the waitlist/);
    const rows = await withTenant(kit.A, (tx) => tx.select().from(schema.waitlist).where(eq(schema.waitlist.status, "open")));
    expect(rows.length).toBe(WAITLIST_CAP);
  });

  it("won't book or drag a visit onto a class the provider is teaching", async () => {
    const start = at(3, "10:00");
    await withTenant(kit.A, (tx) => tx.insert(schema.classSessions).values({ businessId: kit.A, serviceId: cut, staffId, startAt: start, endAt: new Date(start.getTime() + 3_600_000), capacity: 5, priceCents: 0 }));
    await expect(bookAppointment({ businessId: kit.A, clientId, serviceId: cut, staffId, startAt: new Date(start.getTime() + 15 * 60_000), createdByUserId: userId })).rejects.toThrow(/class this provider is teaching/);
    const { appointmentId } = await bookAppointment({ businessId: kit.A, clientId, serviceId: cut, staffId, startAt: at(3, "12:00"), createdByUserId: userId });
    const item = (await withTenant(kit.A, (tx) => tx.query.appointmentItems.findFirst({ where: eq(schema.appointmentItems.appointmentId, appointmentId) })))!;
    await expect(rescheduleService({ businessId: kit.A, itemId: item.id, newStartAt: start, actorUserId: userId })).rejects.toThrow(/class this provider is teaching/);
  });

  it("books a standing appointment at a time off the slot grid", async () => {
    const r = await createSeries({ businessId: kit.A, timeZone: tz, slotIntervalMin: 15, clientId, serviceId: cut, staffId, firstStartAt: at(5, "14:10"), intervalWeeks: 1, occurrences: 2, notes: null, createdByUserId: userId });
    expect(r.created.length).toBe(2);
    const late = createSeries({ businessId: kit.A, timeZone: tz, slotIntervalMin: 15, clientId, serviceId: cut, staffId, firstStartAt: at(6, "19:50"), intervalWeeks: 1, occurrences: 2, notes: null, createdByUserId: userId });
    await expect(late).rejects.toThrow(/None of those dates/); // runs past 20:00
    expect((await withTenant(kit.A, (tx) => tx.select().from(schema.appointments).where(and(eq(schema.appointments.clientId, clientId))))).length).toBe(3);
  });
});
