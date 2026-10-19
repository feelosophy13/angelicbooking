/**
 * Integration test: a role that sees only its own calendar sees only its own tickets: credited on a line, or an empty ticket they opened in
 * the last hour. Having rung a ticket up is not ownership once it has lines (a demoted login would keep seeing clients' tickets).
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

  it("shows a provider the tickets she is credited on and the empty one she just opened, not a colleague's or one she merely rang up", async () => {
    const mine = await openWalkInSale({ businessId: kit.A, actorUserId: owner, currency: "usd" });
    await addServiceLine({ businessId: kit.A, saleId: mine, serviceId, staffId: avaStaff, taxRateBps: 0, actorUserId: owner });
    const priyas = await openWalkInSale({ businessId: kit.A, actorUserId: owner, currency: "usd" });
    await addServiceLine({ businessId: kit.A, saleId: priyas, serviceId, staffId: priyaStaff, taxRateBps: 0, actorUserId: owner });
    // Just opened by Ava, nothing on it yet: hers to finish.
    const justOpened = await openWalkInSale({ businessId: kit.A, actorUserId: ava, currency: "usd" });
    // Rang up by Ava for Priya's work: Priya's ticket, not Ava's.
    const rangUpForPriya = await openWalkInSale({ businessId: kit.A, actorUserId: ava, currency: "usd" });
    await addServiceLine({ businessId: kit.A, saleId: rangUpForPriya, serviceId, staffId: priyaStaff, taxRateBps: 0, actorUserId: ava });
    // Opened by Ava two hours ago and never filled: no longer hers.
    const stale = await openWalkInSale({ businessId: kit.A, actorUserId: ava, currency: "usd" });
    await withTenant(kit.A, (tx) => tx.update(schema.sales).set({ createdAt: new Date(Date.now() - 2 * 3_600_000) }).where(eq(schema.sales.id, stale)));
    const own = { staffId: avaStaff, userId: ava };
    expect(await isOwnSale(kit.A, mine, own)).toBe(true);
    expect(await isOwnSale(kit.A, priyas, own)).toBe(false);
    expect(await isOwnSale(kit.A, justOpened, own)).toBe(true);
    expect(await isOwnSale(kit.A, rangUpForPriya, own)).toBe(false);
    expect(await isOwnSale(kit.A, stale, own)).toBe(false);
    const { rows } = await listSales(kit.A, { status: "all", own });
    expect(rows.map((r) => r.sale.id).sort()).toEqual([mine, justOpened].sort());
    // A login not linked to a staff member gets only the empty ticket it just opened.
    expect(await isOwnSale(kit.A, justOpened, { staffId: null, userId: ava })).toBe(true);
    expect(await isOwnSale(kit.A, rangUpForPriya, { staffId: null, userId: ava })).toBe(false);
  });
});
