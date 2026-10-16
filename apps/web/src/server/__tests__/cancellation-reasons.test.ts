/**
 * Integration test: cancellation reasons. Seeds per business, records the reason / who cancelled / whether it fell inside the
 * window on the appointment, rejects a reason from another business, and groups cancellations for Reports.
 * Needs Postgres at DATABASE_URL (the app role, RLS forced); skipped otherwise.
 */
import "../../../../../packages/db/src/env";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db, schema, withTenant } from "@angelic/db";
import { cancellationsByReason, listCancellationReasons, setCancellationReasonActive } from "@/server/cancellation-reasons";
import { BookingError, setAppointmentStatus } from "@/server/booking";
import { reachable, setupKit } from "@/lib/__tests__/api-test-kit";

const up = await reachable();

describe.skipIf(!up)("cancellation reasons", () => {
  let kit: Awaited<ReturnType<typeof setupKit>>;
  let staffId: string;
  beforeAll(async () => {
    kit = await setupKit([]);
    await withTenant(kit.A, async (tx) => {
      await tx.insert(schema.locations).values({ businessId: kit.A, name: "Main", isDefault: true });
      const [s] = await tx.insert(schema.staff).values({ businessId: kit.A, displayName: "Sam" }).returning({ id: schema.staff.id });
      staffId = s!.id;
    });
  });
  afterAll(async () => {
    await kit?.teardown();
  });

  async function appt(hoursAhead: number, priceCents: number, deposit = 0) {
    return withTenant(kit.A, async (tx) => {
      const [a] = await tx.insert(schema.appointments).values({ businessId: kit.A, depositCents: deposit, depositStatus: deposit ? "paid" : "none" }).returning({ id: schema.appointments.id });
      const startAt = new Date(Date.now() + hoursAhead * 3_600_000);
      await tx.insert(schema.appointmentItems).values({ businessId: kit.A, appointmentId: a!.id, staffId, serviceName: "Cut", priceCents, durationMinutes: 30, startAt, endAt: new Date(startAt.getTime() + 1_800_000) } as never);
      return a!.id;
    });
  }

  it("seeds defaults, hides the salon-side reason from clients", async () => {
    const list = await listCancellationReasons(kit.A);
    expect(list.map((r) => r.name)).toContain("Client is sick");
    expect(list.find((r) => r.name.startsWith("Salon cancelled"))?.clientVisible).toBe(false);
  });

  it("records reason, who cancelled and window; reports group them", async () => {
    const list = await listCancellationReasons(kit.A);
    const sick = list.find((r) => r.name === "Client is sick")!;
    const late = await appt(2, 8000, 2000);
    const early = await appt(200, 5000);
    await setAppointmentStatus(kit.A, late, "cancelled", "client", "Cancelled online by client", sick.id);
    await setAppointmentStatus(kit.A, early, "cancelled", "user_x", null, null);
    const a = await withTenant(kit.A, (tx) => tx.query.appointments.findFirst({ where: eq(schema.appointments.id, late) }));
    expect([a?.cancellationReasonId, a?.cancelledBy, a?.cancelledLate]).toEqual([sick.id, "client", true]);
    const b = await withTenant(kit.A, (tx) => tx.query.appointments.findFirst({ where: eq(schema.appointments.id, early) }));
    expect([b?.cancellationReasonId, b?.cancelledBy, b?.cancelledLate]).toEqual([null, "staff", false]);
    const rows = await withTenant(kit.A, (tx) => cancellationsByReason(tx, new Date(Date.now() - 3_600_000), new Date(Date.now() + 3_600_000)));
    const s = rows.find((r) => r.reasonId === sick.id)!;
    expect([s.count, s.lateCount, s.byClient, s.lostCents, s.depositKeptCents]).toEqual([1, 1, 1, 8000, 2000]);
    expect(rows.find((r) => r.reasonId === null)?.name).toBe("No reason given");
  });

  it("rejects a reason that is not this business's", async () => {
    const other = await withTenant(kit.B, async (tx) => {
      const [r] = await tx.insert(schema.cancellationReasons).values({ businessId: kit.B, name: "Theirs" }).returning({ id: schema.cancellationReasons.id });
      return r!.id;
    });
    const id = await appt(100, 1000);
    await expect(setAppointmentStatus(kit.A, id, "cancelled", "u", null, other)).rejects.toBeInstanceOf(BookingError);
  });

  it("keeps at least one active reason", async () => {
    const list = await listCancellationReasons(kit.A);
    for (const r of list.slice(0, -1)) await setCancellationReasonActive(kit.A, r.id, false);
    await expect(setCancellationReasonActive(kit.A, list.at(-1)!.id, false)).rejects.toThrow("Keep at least one");
  });
});
