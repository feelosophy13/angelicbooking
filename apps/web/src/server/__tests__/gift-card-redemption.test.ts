/**
 * Integration test: redeeming a gift card at checkout names who redeemed it, and neither the payment nor the audit row keeps the full code
 * (a code plus a balance is spendable at any checkout). Needs Postgres at DATABASE_URL (the app role, RLS forced); skipped otherwise.
 */
import "../../../../../packages/db/src/env";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { db, schema, withTenant } from "@angelic/db";
import { addServiceLine, openWalkInSale } from "@/server/sales";
import { redeemGiftCard } from "@/server/offers";
import { reachable, setupKit } from "@/lib/__tests__/api-test-kit";

vi.mock("next/server", async (orig) => ({ ...(await orig<typeof import("next/server")>()), after: () => undefined }));

const up = await reachable();

describe.skipIf(!up)("gift card redemption", () => {
  let kit: Awaited<ReturnType<typeof setupKit>>;
  let userId: string;
  let staffId: string;
  let serviceId: string;
  beforeAll(async () => {
    kit = await setupKit([]);
    userId = `u_${kit.A}`;
    await db.insert(schema.user).values({ id: userId, name: "Desk", email: `${userId}@example.test`, emailVerified: true });
    await withTenant(kit.A, async (tx) => {
      await tx.insert(schema.locations).values({ businessId: kit.A, name: "Main", isDefault: true });
      const [s] = await tx.insert(schema.staff).values({ businessId: kit.A, displayName: "Stylist" }).returning({ id: schema.staff.id });
      staffId = s!.id;
      const [sv] = await tx.insert(schema.services).values({ businessId: kit.A, name: "Cut", durationMin: 30, priceCents: 5000 }).returning({ id: schema.services.id });
      serviceId = sv!.id;
    });
  });
  afterAll(async () => {
    await kit?.teardown();
    await db.delete(schema.user).where(eq(schema.user.id, userId));
  });

  it("records who redeemed the card and keeps only the last four of the code", async () => {
    const saleId = await openWalkInSale({ businessId: kit.A, actorUserId: userId, currency: "usd" });
    await addServiceLine({ businessId: kit.A, saleId, serviceId, staffId, taxRateBps: 0, actorUserId: userId });
    const [card] = await withTenant(kit.A, (tx) => tx.insert(schema.giftCards).values({ businessId: kit.A, code: "GC-TEST-7Q2M", initialCents: 10_000, balanceCents: 10_000 }).returning({ id: schema.giftCards.id }));
    expect(await redeemGiftCard({ businessId: kit.A, saleId, code: "gc-test-7q2m", amountCents: 3000, actorUserId: userId })).toBe(3000);
    const [payment] = await withTenant(kit.A, (tx) => tx.select().from(schema.payments).where(and(eq(schema.payments.saleId, saleId), eq(schema.payments.method, "gift_card"))));
    expect(payment).toMatchObject({ createdByUserId: userId, giftCardId: card!.id, amountCents: 3000, note: "Gift card ••••7Q2M" });
    const [row] = await withTenant(kit.A, (tx) => tx.select().from(schema.auditLog).where(and(eq(schema.auditLog.action, "payment.gift_card"), eq(schema.auditLog.entityId, saleId))));
    expect(row).toMatchObject({ actorUserId: userId });
    expect(row!.diff).toContain(card!.id);
    expect(row!.diff).toContain(userId);
    expect(row!.diff).not.toContain("GC-TEST-7Q2M");
    expect((await withTenant(kit.A, (tx) => tx.query.giftCards.findFirst({ where: eq(schema.giftCards.id, card!.id) })))!.balanceCents).toBe(7000);
  });
});
