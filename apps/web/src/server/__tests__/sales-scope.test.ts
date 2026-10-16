/**
 * Integration test: a role that sees only its own calendar sees only its own tickets (credited on a line, or rang it up).
 * Needs Postgres at DATABASE_URL (the app role, RLS forced); skipped otherwise.
 */
import "../../../../../packages/db/src/env";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { db, schema, withTenant } from "@angelic/db";
import { addServiceLine, isOwnSale, listSales, openWalkInSale } from "@/server/sales";
import { reachable, setupKit } from "@/lib/__tests__/api-test-kit";

vi.mock("next/server", async (orig) => ({ ...(await orig<typeof import("next/server")>()), after: () => undefined }));

const up = await reachable();

describe.skipIf(!up)("own tickets", () => {
  let kit: Awaited<ReturnType<typeof setupKit>>;
  const owner = `owner_${Date.now()}`;
  const ava = `ava_${Date.now()}`;
  let avaStaff: string;
  let priyaStaff: string;
  let serviceId: string;
  beforeAll(async () => {
    kit = await setupKit([]);
    await db.insert(schema.user).values([
      { id: owner, name: "Owner", email: `${owner}@example.test`, emailVerified: true },
      { id: ava, name: "Ava", email: `${ava}@example.test`, emailVerified: true },
    ]);
    await withTenant(kit.A, async (tx) => {
      const [a] = await tx.insert(schema.staff).values({ businessId: kit.A, displayName: "Ava", userId: ava }).returning({ id: schema.staff.id });
      const [p] = await tx.insert(schema.staff).values({ businessId: kit.A, displayName: "Priya" }).returning({ id: schema.staff.id });
      avaStaff = a!.id;
      priyaStaff = p!.id;
      const [sv] = await tx.insert(schema.services).values({ businessId: kit.A, name: "Cut", durationMin: 30, priceCents: 5000 }).returning({ id: schema.services.id });
      serviceId = sv!.id;
    });
  });
  afterAll(async () => {
    await kit?.teardown();
    await db.delete(schema.user).where(eq(schema.user.id, owner));
    await db.delete(schema.user).where(eq(schema.user.id, ava));
  });

  it("shows a provider her own tickets and the ones she rang up, not a colleague's", async () => {
    const mine = await openWalkInSale({ businessId: kit.A, actorUserId: owner, currency: "usd" });
    await addServiceLine({ businessId: kit.A, saleId: mine, serviceId, staffId: avaStaff, taxRateBps: 0, actorUserId: owner });
    const priyas = await openWalkInSale({ businessId: kit.A, actorUserId: owner, currency: "usd" });
    await addServiceLine({ businessId: kit.A, saleId: priyas, serviceId, staffId: priyaStaff, taxRateBps: 0, actorUserId: owner });
    const rangUp = await openWalkInSale({ businessId: kit.A, actorUserId: ava, currency: "usd" });
    const own = { staffId: avaStaff, userId: ava };
    expect(await isOwnSale(kit.A, mine, own)).toBe(true);
    expect(await isOwnSale(kit.A, priyas, own)).toBe(false);
    expect(await isOwnSale(kit.A, rangUp, own)).toBe(true);
    const { rows } = await listSales(kit.A, { status: "all", own });
    expect(rows.map((r) => r.sale.id).sort()).toEqual([mine, rangUp].sort());
  });
});
