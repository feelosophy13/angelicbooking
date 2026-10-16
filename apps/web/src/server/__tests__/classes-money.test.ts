/**
 * Integration test: an online class seat must match its session's service (so a free service can't carry a paid class's seat), and
 * cancelling a class refunds every seat's deposit. Needs Postgres at DATABASE_URL (the app role, RLS forced); skipped otherwise. The
 * business refunds deposits as store credit here, so nothing calls Stripe.
 */
import "../../../../../packages/db/src/env";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { db, schema, withTenant } from "@angelic/db";
import { assertClassSeatOpen } from "@/server/public-booking";
import { cancelSession, enrolClient } from "@/server/classes";
import { reachable, setupKit } from "@/lib/__tests__/api-test-kit";

vi.mock("next/server", async (orig) => ({ ...(await orig<typeof import("next/server")>()), after: () => undefined }));

const up = await reachable();

describe.skipIf(!up)("classes and money", () => {
  let kit: Awaited<ReturnType<typeof setupKit>>;
  let userId: string;
  let staffId: string;
  let yoga: string;
  let freebie: string;
  let sessionId: string;
  let clientId: string;
  const start = new Date(Date.now() + 3 * 86_400_000);
  start.setUTCMinutes(0, 0, 0);
  beforeAll(async () => {
    kit = await setupKit([]);
    userId = `u_${kit.A}`;
    await db.insert(schema.user).values({ id: userId, name: "Tester", email: `${userId}@example.test`, emailVerified: true });
    await withTenant(kit.A, async (tx) => {
      await tx.update(schema.businesses).set({ depositRefundAs: "store_credit", onlineBookingEnabled: true }).where(eq(schema.businesses.id, kit.A));
      const [s] = await tx.insert(schema.staff).values({ businessId: kit.A, displayName: "Coach" }).returning({ id: schema.staff.id });
      staffId = s!.id;
      const [y] = await tx.insert(schema.services).values({ businessId: kit.A, name: "Yoga", durationMin: 60, priceCents: 3000, capacity: 10, depositCents: 3000, bookableOnline: true }).returning({ id: schema.services.id });
      const [f] = await tx.insert(schema.services).values({ businessId: kit.A, name: "Free chat", durationMin: 60, priceCents: 0, bookableOnline: true }).returning({ id: schema.services.id });
      yoga = y!.id;
      freebie = f!.id;
      const [cs] = await tx.insert(schema.classSessions).values({ businessId: kit.A, serviceId: yoga, staffId, startAt: start, endAt: new Date(start.getTime() + 3_600_000), capacity: 10, priceCents: 3000 }).returning({ id: schema.classSessions.id });
      sessionId = cs!.id;
      const [c] = await tx.insert(schema.clients).values({ businessId: kit.A, firstName: "Ana" }).returning({ id: schema.clients.id });
      clientId = c!.id;
    });
  });
  afterAll(async () => {
    await kit?.teardown();
    if (userId) await db.delete(schema.user).where(eq(schema.user.id, userId));
  });

  it("refuses a class seat booked under another service's id", async () => {
    const business = (await db.query.businesses.findFirst({ where: eq(schema.businesses.id, kit.A) }))!;
    await expect(assertClassSeatOpen(business, { classSessionId: sessionId, serviceId: freebie, staffId, startAt: start })).rejects.toThrow(/has changed/);
    await expect(assertClassSeatOpen(business, { classSessionId: sessionId, serviceId: yoga, staffId, startAt: start })).resolves.toBeUndefined();
  });

  it("refunds every seat's deposit when the class is cancelled", async () => {
    const { appointmentId } = await enrolClient({ businessId: kit.A, sessionId, clientId, notes: null, actorUserId: userId });
    await withTenant(kit.A, (tx) => tx.update(schema.appointments).set({ depositCents: 3000, depositStatus: "paid", depositPaymentIntentId: `pi_class_${kit.A}` }).where(eq(schema.appointments.id, appointmentId)));
    const r = await cancelSession({ businessId: kit.A, sessionId, actorUserId: userId, reason: "Instructor ill" });
    expect(r).toEqual({ ids: [appointmentId], refundFailures: 0 });
    const appt = await withTenant(kit.A, (tx) => tx.query.appointments.findFirst({ where: eq(schema.appointments.id, appointmentId) }));
    const client = await withTenant(kit.A, (tx) => tx.query.clients.findFirst({ where: eq(schema.clients.id, clientId) }));
    expect([appt!.status, appt!.depositStatus, client!.storeCreditCents]).toEqual(["cancelled", "refunded", 3000]);
  });
});
