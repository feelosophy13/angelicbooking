/**
 * Integration test for the appointment status rules every path shares: a cancelled visit can't be marked no-show (or revived), and setting
 * the status it already has reports no change. Needs Postgres at DATABASE_URL (the app role, RLS forced); skipped otherwise.
 */
import "../../../../../packages/db/src/env";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { schema, withTenant } from "@angelic/db";
import { setAppointmentStatus } from "@/server/booking";
import { reachable, setupKit } from "@/lib/__tests__/api-test-kit";

vi.mock("next/server", async (orig) => ({ ...(await orig<typeof import("next/server")>()), after: () => undefined }));

const up = await reachable();

describe.skipIf(!up)("status rules", () => {
  let kit: Awaited<ReturnType<typeof setupKit>>;
  let apptId: string;
  beforeAll(async () => {
    kit = await setupKit([]);
    await withTenant(kit.A, async (tx) => {
      const [s] = await tx.insert(schema.staff).values({ businessId: kit.A, displayName: "Sam" }).returning({ id: schema.staff.id });
      const [c] = await tx.insert(schema.clients).values({ businessId: kit.A, firstName: "Ana" }).returning({ id: schema.clients.id });
      const [a] = await tx.insert(schema.appointments).values({ businessId: kit.A, clientId: c!.id }).returning({ id: schema.appointments.id });
      const start = new Date(Date.now() + 86_400_000);
      await tx.insert(schema.appointmentItems).values({ businessId: kit.A, appointmentId: a!.id, staffId: s!.id, serviceName: "Cut", startAt: start, endAt: new Date(start.getTime() + 3_600_000), priceCents: 5000 });
      apptId = a!.id;
    });
  });
  afterAll(async () => {
    await kit?.teardown();
  });

  it("keeps a cancelled visit cancelled and treats a repeat as no change", async () => {
    expect(await setAppointmentStatus(kit.A, apptId, "confirmed", "u")).toBe(true);
    expect(await setAppointmentStatus(kit.A, apptId, "confirmed", "u")).toBe(false);
    expect(await setAppointmentStatus(kit.A, apptId, "cancelled", "u", "Client called")).toBe(true);
    await expect(setAppointmentStatus(kit.A, apptId, "no_show", "u")).rejects.toThrow(/cancelled/);
    await expect(setAppointmentStatus(kit.A, apptId, "booked", "u")).rejects.toThrow(/cancelled/);
    const a = await withTenant(kit.A, (tx) => tx.query.appointments.findFirst({ where: eq(schema.appointments.id, apptId) }));
    expect([a!.status, a!.cancellationReason]).toEqual(["cancelled", "Client called"]);
  });
});
