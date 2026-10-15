/**
 * Integration test: a walk-in (products-only) ticket end to end: tax-exempt, tips with no service on the ticket, closing a $0 ticket, and a
 * cash payment. Needs Postgres at DATABASE_URL (the app role, RLS forced); skipped otherwise. Nothing here calls a third party.
 */
import "../../../../../packages/db/src/env";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db, schema, withTenant } from "@angelic/db";
import { addProductLine, completeNoCharge, getSale, openWalkInSale, recordManualPayment, removeLine, setSaleNotes, setTaxExempt, setTips } from "@/server/sales";
import { reachable, setupKit } from "@/lib/__tests__/api-test-kit";

const up = await reachable();
const TAX = 600; // 6%

describe.skipIf(!up)("checkout: a products-only ticket", () => {
  let kit: Awaited<ReturnType<typeof setupKit>>;
  let userId: string;
  let staffId: string;
  let productId: string;
  beforeAll(async () => {
    kit = await setupKit([]);
    userId = `u_${kit.A}`;
    await db.insert(schema.user).values({ id: userId, name: "Tester", email: `${userId}@example.test`, emailVerified: true });
    await withTenant(kit.A, async (tx) => {
      await tx.insert(schema.locations).values({ businessId: kit.A, name: "Main", isDefault: true });
      const [s] = await tx.insert(schema.staff).values({ businessId: kit.A, displayName: "Sam" }).returning({ id: schema.staff.id });
      staffId = s!.id;
      const [p] = await tx.insert(schema.products).values({ businessId: kit.A, name: "Serum", priceCents: 6500, taxable: true, kind: "retail" }).returning({ id: schema.products.id });
      productId = p!.id;
    });
  });
  afterAll(async () => {
    await kit?.teardown();
    if (userId) await db.delete(schema.user).where(eq(schema.user.id, userId));
  });

  const open = () => openWalkInSale({ businessId: kit.A, actorUserId: userId, currency: "usd" });
  const base = () => ({ businessId: kit.A, actorUserId: userId, taxRateBps: TAX });

  it("adds a product, taxes it, and takes a tip for the person credited on the product", async () => {
    const saleId = await open();
    await addProductLine({ ...base(), saleId, productId, quantity: 1, staffId });
    let s = (await getSale(kit.A, saleId))!.sale;
    expect([s.subtotalCents, s.taxCents, s.totalCents]).toEqual([6500, 390, 6890]);
    // No service on the ticket: an unassigned tip follows the product's credit; a tip named for someone goes to them.
    await setTips({ businessId: kit.A, saleId, tips: [{ staffId: null, amountCents: 1300 }], taxRateBps: TAX });
    const d = (await getSale(kit.A, saleId))!;
    expect(d.sale.tipCents).toBe(1300);
    expect(d.lines.filter((l) => l.kind === "tip").map((l) => [l.staffId, l.amountCents])).toEqual([[staffId, 1300]]);
    s = d.sale;
    expect(s.totalCents).toBe(8190);
  });

  it("can be marked tax exempt and back, and keeps a private note", async () => {
    const saleId = await open();
    await addProductLine({ ...base(), saleId, productId, quantity: 2, staffId: null });
    await setTaxExempt({ ...base(), saleId, exempt: true });
    let s = (await getSale(kit.A, saleId))!.sale;
    expect([s.taxExempt, s.taxCents, s.totalCents]).toEqual([true, 0, 13000]);
    await setTaxExempt({ ...base(), saleId, exempt: false });
    s = (await getSale(kit.A, saleId))!.sale;
    expect([s.taxExempt, s.taxCents]).toEqual([false, 780]);
    await setSaleNotes({ businessId: kit.A, saleId, notes: "  gift for Maria ", actorUserId: userId });
    expect((await getSale(kit.A, saleId))!.sale.notes).toBe("gift for Maria");
  });

  it("closes a ticket with nothing due only when it has something on it", async () => {
    const empty = await open();
    await expect(completeNoCharge({ ...base(), saleId: empty })).rejects.toThrow(/Add something/);
    const owed = await open();
    await addProductLine({ ...base(), saleId: owed, productId, quantity: 1, staffId: null });
    await expect(completeNoCharge({ ...base(), saleId: owed })).rejects.toThrow(/amount due/);
  });

  it("closes on a cash payment, and a cash payment is capped at what is due", async () => {
    const saleId = await open();
    await addProductLine({ ...base(), saleId, productId, quantity: 1, staffId: null });
    await recordManualPayment({ ...base(), saleId, method: "cash", amountCents: 10_000, note: "Received $100.00, change $31.10" });
    const d = (await getSale(kit.A, saleId))!;
    expect(d.sale.status).toBe("paid");
    expect(d.payments.map((p) => p.amountCents)).toEqual([6890]);
    await expect(removeLine({ businessId: kit.A, saleId, lineId: d.lines[0]!.id, taxRateBps: TAX })).rejects.toThrow(/paid/);
  });
});
