/**
 * Integration test for catalog fixes: saving a stylist's services keeps their hidden ones, receiving a purchase order twice can't add more
 * than was ordered, and a retail product without a price can't be rung up. Needs Postgres at DATABASE_URL (the app role, RLS forced);
 * skipped otherwise.
 */
import "../../../../../packages/db/src/env";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { db, schema, withTenant } from "@angelic/db";
import { applyStaffServices } from "@/server/stylist-pricing";
import { createPurchaseOrder, receiveOrder } from "@/server/inventory";
import { addProductLine, openWalkInSale } from "@/server/sales";
import { reachable, setupKit } from "@/lib/__tests__/api-test-kit";

vi.mock("next/server", async (orig) => ({ ...(await orig<typeof import("next/server")>()), after: () => undefined }));

const up = await reachable();

describe.skipIf(!up)("catalog fixes", () => {
  let kit: Awaited<ReturnType<typeof setupKit>>;
  let userId: string;
  let staffId: string;
  beforeAll(async () => {
    kit = await setupKit([]);
    userId = `u_${kit.A}`;
    await db.insert(schema.user).values({ id: userId, name: "Tester", email: `${userId}@example.test`, emailVerified: true });
    await withTenant(kit.A, async (tx) => {
      await tx.insert(schema.locations).values({ businessId: kit.A, name: "Main", isDefault: true });
      const [s] = await tx.insert(schema.staff).values({ businessId: kit.A, displayName: "Sam" }).returning({ id: schema.staff.id });
      staffId = s!.id;
    });
  });
  afterAll(async () => {
    await kit?.teardown();
    if (userId) await db.delete(schema.user).where(eq(schema.user.id, userId));
  });

  it("keeps a stylist's hidden (seasonal) services and their own price when their services are saved", async () => {
    const [shown, hidden] = await withTenant(kit.A, async (tx) => [
      (await tx.insert(schema.services).values({ businessId: kit.A, name: "Cut", durationMin: 30, priceCents: 5000 }).returning())[0]!,
      (await tx.insert(schema.services).values({ businessId: kit.A, name: "Holiday glam", durationMin: 60, priceCents: 9000, active: false }).returning())[0]!,
    ]);
    await withTenant(kit.A, (tx) => tx.insert(schema.staffServices).values([{ businessId: kit.A, staffId, serviceId: shown.id }, { businessId: kit.A, staffId, serviceId: hidden.id, priceCentsOverride: 12_000 }]));
    // The form only lists active services; the stylist unticks nothing and saves.
    await withTenant(kit.A, (tx) => applyStaffServices(tx, kit.A, staffId, [{ serviceId: shown.id, price: undefined, duration: undefined }], { activeOnly: true }));
    const rows = await withTenant(kit.A, (tx) => tx.select().from(schema.staffServices).where(eq(schema.staffServices.staffId, staffId)));
    expect(rows.find((r) => r.serviceId === hidden.id)?.priceCentsOverride).toBe(12_000);
  });

  it("never receives more than was ordered, so a doubled receipt adds stock once", async () => {
    const [p] = await withTenant(kit.A, (tx) => tx.insert(schema.products).values({ businessId: kit.A, name: "Toner", priceCents: 0, kind: "backbar", costCents: 500 }).returning());
    const po = await createPurchaseOrder({ businessId: kit.A, supplierId: null, lines: [{ productId: p!.id, qty: 10, unitCostCents: 650 }], actorUserId: userId });
    const lines = await withTenant(kit.A, (tx) => tx.select().from(schema.purchaseOrderLines).where(eq(schema.purchaseOrderLines.purchaseOrderId, po.id)));
    const receive = () => receiveOrder({ businessId: kit.A, id: po.id, lines: [{ lineId: lines[0]!.id, qty: 10 }], actorUserId: userId });
    const both = await Promise.allSettled([receive(), receive()]);
    expect(both.filter((r) => r.status === "fulfilled").length).toBe(1);
    const moves = await withTenant(kit.A, (tx) => tx.select().from(schema.stockMovements).where(and(eq(schema.stockMovements.productId, p!.id), eq(schema.stockMovements.reason, "received"))));
    expect(moves.map((m) => [m.delta, m.unitCostCents])).toEqual([[10, 650]]);
  });

  it("won't ring up a retail product that has no price", async () => {
    const [p] = await withTenant(kit.A, (tx) => tx.insert(schema.products).values({ businessId: kit.A, name: "Repriced serum", priceCents: 0, kind: "retail" }).returning());
    const saleId = await openWalkInSale({ businessId: kit.A, actorUserId: userId, currency: "usd" });
    await expect(addProductLine({ businessId: kit.A, saleId, productId: p!.id, quantity: 1, staffId: null, actorUserId: userId, taxRateBps: 0 })).rejects.toThrow(/no price yet/);
  });
});
