/**
 * Integration test for deliberate double-booking: an overlap is refused by default, the desk's "Book anyway" books it (and logs it),
 * blocked time still wins, and an online booking can't ask for it. Needs Postgres at DATABASE_URL (the app role, RLS forced); skipped otherwise.
 */
import "../../../../../packages/db/src/env";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { db, schema, withTenant } from "@angelic/db";
import { instantToISODate, zonedToInstant } from "@angelic/core";
import { shiftISODate } from "@/lib/utils";
import { addServiceToAppointment, blockTime, bookAppointment, OverlapError } from "@/server/booking";
import { reachable, setupKit } from "@/lib/__tests__/api-test-kit";

vi.mock("next/server", async (orig) => ({ ...(await orig<typeof import("next/server")>()), after: () => undefined }));

const up = await reachable();

describe.skipIf(!up)("double-booking", () => {
  let kit: Awaited<ReturnType<typeof setupKit>>;
  let userId: string;
  let staffId: string;
  let cut: string;
  let clientId: string;
  let tz: string;
  const at = (daysOut: number, hhmm: string) => zonedToInstant(shiftISODate(instantToISODate(new Date(), tz), daysOut), hhmm, tz);
  const itemsOf = (appointmentId: string) => withTenant(kit.A, (tx) => tx.select().from(schema.appointmentItems).where(eq(schema.appointmentItems.appointmentId, appointmentId)));
  beforeAll(async () => {
    kit = await setupKit([]);
    userId = `u_${kit.A}`;
    await db.insert(schema.user).values({ id: userId, name: "Tester", email: `${userId}@example.test`, emailVerified: true });
    await withTenant(kit.A, async (tx) => {
      const [s] = await tx.insert(schema.staff).values({ businessId: kit.A, displayName: "Sam" }).returning({ id: schema.staff.id });
      staffId = s!.id;
      await tx.insert(schema.staffSchedules).values([0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ businessId: kit.A, staffId, weekday, startTime: "08:00", endTime: "20:00" })));
      cut = (await tx.insert(schema.services).values({ businessId: kit.A, name: "Cut", durationMin: 60, priceCents: 5000, bookableOnline: true }).returning())[0]!.id;
      clientId = (await tx.insert(schema.clients).values({ businessId: kit.A, firstName: "Ana", phone: "+15550001111" }).returning())[0]!.id;
    });
    tz = (await db.query.businesses.findFirst({ where: eq(schema.businesses.id, kit.A) }))!.timezone;
  });
  afterAll(async () => {
    await kit?.teardown();
    if (userId) await db.delete(schema.user).where(eq(schema.user.id, userId));
  });

  it("refuses an overlap by default and books it with the override", async () => {
    const base = { businessId: kit.A, clientId, serviceId: cut, staffId, createdByUserId: userId };
    await bookAppointment({ ...base, startAt: at(2, "10:00") });
    const clash = bookAppointment({ ...base, startAt: at(2, "10:30") });
    await expect(clash).rejects.toBeInstanceOf(OverlapError);

    const { appointmentId } = await bookAppointment({ ...base, startAt: at(2, "10:30"), allowOverlap: true });
    const items = await itemsOf(appointmentId);
    expect(items.length).toBe(1);
    expect(items[0]!.allowOverlap).toBe(true);
    const log = await withTenant(kit.A, (tx) => tx.select().from(schema.auditLog).where(and(eq(schema.auditLog.entityId, appointmentId), eq(schema.auditLog.action, "appointment.double_booked"))));
    expect(log.length).toBe(1);
    expect(log[0]!.actorUserId).toBe(userId);

    // A service added to that visit with the override overlaps too; without it, it's refused.
    await expect(addServiceToAppointment({ businessId: kit.A, appointmentId, serviceId: cut, staffId, startAt: at(2, "10:15"), actorUserId: userId })).rejects.toBeInstanceOf(OverlapError);
    await addServiceToAppointment({ businessId: kit.A, appointmentId, serviceId: cut, staffId, startAt: at(2, "10:15"), actorUserId: userId, allowOverlap: true });
    expect((await itemsOf(appointmentId)).length).toBe(2);
  });

  it("lets the override through a class but never onto blocked time", async () => {
    const start = at(3, "10:00");
    await withTenant(kit.A, (tx) => tx.insert(schema.classSessions).values({ businessId: kit.A, serviceId: cut, staffId, startAt: start, endAt: new Date(start.getTime() + 3_600_000), capacity: 5, priceCents: 0 }));
    const base = { businessId: kit.A, clientId, serviceId: cut, staffId, createdByUserId: userId };
    await expect(bookAppointment({ ...base, startAt: at(3, "10:30") })).rejects.toBeInstanceOf(OverlapError);
    await bookAppointment({ ...base, startAt: at(3, "10:30"), allowOverlap: true });

    await blockTime({ businessId: kit.A, staffId, startAt: at(3, "13:00"), endAt: at(3, "14:00"), reason: "Lunch", actorUserId: userId });
    await expect(bookAppointment({ ...base, startAt: at(3, "13:30"), allowOverlap: true })).rejects.toThrow(/blocked off/);
  });

  it("never double-books an online booking", async () => {
    const base = { businessId: kit.A, clientId, serviceId: cut, staffId, createdByUserId: null };
    await bookAppointment({ ...base, startAt: at(4, "10:00"), source: "online" });
    await expect(bookAppointment({ ...base, startAt: at(4, "10:30"), source: "online", allowOverlap: true })).rejects.toBeInstanceOf(OverlapError);
    const rows = await withTenant(kit.A, (tx) => tx.select().from(schema.appointmentItems).where(eq(schema.appointmentItems.allowOverlap, true)));
    expect(rows.every((r) => r.startAt.getTime() < at(4, "00:00").getTime())).toBe(true);
  });
});
