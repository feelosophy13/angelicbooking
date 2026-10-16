/**
 * Integration test: a membership's "% off other services" prices the member's service lines, and comes off again if the client on the
 * ticket changes. Needs Postgres at DATABASE_URL (the app role, RLS forced); skipped otherwise.
 */
import "../../../../../packages/db/src/env";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { db, schema, withTenant } from "@angelic/db";
import { addServiceLine, getSale, openWalkInSale, setSaleClient } from "@/server/sales";
import { reachable, setupKit } from "@/lib/__tests__/api-test-kit";

vi.mock("next/server", async (orig) => ({ ...(await orig<typeof import("next/server")>()), after: () => undefined }));

const up = await reachable();

describe.skipIf(!up)("member pricing", () => {
  let kit: Awaited<ReturnType<typeof setupKit>>;
  let userId: string;
  let serviceId: string;
  let member: string;
  beforeAll(async () => {
    kit = await setupKit([]);
    userId = `u_${kit.A}`;
    await db.insert(schema.user).values({ id: userId, name: "Tester", email: `${userId}@example.test`, emailVerified: true });
    await withTenant(kit.A, async (tx) => {
      serviceId = (await tx.insert(schema.services).values({ businessId: kit.A, name: "Color", durationMin: 90, priceCents: 12_000 }).returning())[0]!.id;
      member = (await tx.insert(schema.clients).values({ businessId: kit.A, firstName: "Mia" }).returning())[0]!.id;
      const plan = (await tx.insert(schema.membershipPlans).values({ businessId: kit.A, name: "VIP", priceCents: 5000, discountBps: 1500 }).returning())[0]!;
      await tx.insert(schema.clientMemberships).values({ businessId: kit.A, clientId: member, planId: plan.id, currentPeriodEnd: new Date(Date.now() + 20 * 86_400_000) });
    });
  });
  afterAll(async () => {
    await kit?.teardown();
    if (userId) await db.delete(schema.user).where(eq(schema.user.id, userId));
  });

  it("gives a member 15% off services, and takes it off when the client changes", async () => {
    const saleId = await openWalkInSale({ businessId: kit.A, actorUserId: userId, currency: "usd", clientId: member });
    await addServiceLine({ businessId: kit.A, saleId, serviceId, staffId: null, taxRateBps: 0, actorUserId: userId });
    let d = (await getSale(kit.A, saleId))!;
    expect([d.lines[0]!.amountCents, d.lines[0]!.memberDiscountBps, d.sale.totalCents]).toEqual([10_200, 1500, 10_200]);
    await setSaleClient({ businessId: kit.A, saleId, clientId: null, actorUserId: userId });
    d = (await getSale(kit.A, saleId))!;
    expect([d.lines[0]!.amountCents, d.lines[0]!.memberDiscountBps, d.sale.totalCents]).toEqual([12_000, 0, 12_000]);
  });
});
