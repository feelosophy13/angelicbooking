/**
 * Integration test: invoices. Totals come from the sale pricing (services, products, custom lines, discount, tax); a check and a card
 * payment both land on the sale, the one that pays it off closes it as an ordinary paid sale (commission line credited, stock taken,
 * receipts sent once); the link's token opens only that business's sent invoice; reminders go once per step. Needs Postgres at
 * DATABASE_URL (the app role, RLS forced); skipped otherwise. Stripe is mocked.
 */
import "../../../../../packages/db/src/env";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { db, schema, withTenant } from "@angelic/db";
import { reachable, setupKit } from "@/lib/__tests__/api-test-kit";

type FakePI = { id: string; status: string; amount: number; metadata: Record<string, string>; latest_charge: unknown; client_secret: string };
const intents = new Map<string, FakePI>();
let n = 0;
vi.mock("@/lib/stripe", async (orig) => ({
  ...(await orig<typeof import("@/lib/stripe")>()),
  isStripeConfigured: () => true,
  stripe: () => ({
    paymentIntents: {
      create: async (p: { amount: number; metadata: Record<string, string> }) => {
        const pi = { id: `pi_inv_${++n}`, status: "requires_payment_method", amount: p.amount, metadata: p.metadata, latest_charge: null, client_secret: `secret_${n}` };
        intents.set(pi.id, pi);
        return structuredClone(pi);
      },
      retrieve: async (id: string) => structuredClone(intents.get(id)!),
      cancel: async (id: string) => {
        const pi = intents.get(id)!;
        pi.status = "canceled";
        return structuredClone(pi);
      },
    },
  }),
}));
vi.mock("@/server/stripe-connect", async (orig) => ({ ...(await orig<typeof import("@/server/stripe-connect")>()), ensureStripeCustomer: async () => "cus_test" }));
vi.mock("next/server", async (orig) => ({ ...(await orig<typeof import("next/server")>()), after: () => undefined }));
process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY ??= "pk_test_invoices";

const inv = await import("@/server/invoices");
const { listSales } = await import("@/server/sales");
const { invoiceState } = await import("@/lib/invoices");
const up = await reachable();

describe.skipIf(!up)("invoices", () => {
  let kit: Awaited<ReturnType<typeof setupKit>>;
  let business: typeof schema.businesses.$inferSelect;
  let businessB: typeof schema.businesses.$inferSelect;
  let userId: string;
  let clientId: string;
  let staffId: string;
  let serviceId: string;
  let productId: string;
  let locationId: string;

  beforeAll(async () => {
    kit = await setupKit([]);
    userId = `u_${kit.A}`;
    await db.insert(schema.user).values({ id: userId, name: "Tester", email: `${userId}@example.test`, emailVerified: true });
    business = (await db.update(schema.businesses).set({ stripeAccountId: "acct_inv", stripeChargesEnabled: true, taxRateBps: 600, email: "owner@kit.test", timezone: "America/New_York" }).where(eq(schema.businesses.id, kit.A)).returning())[0]!;
    businessB = (await db.query.businesses.findFirst({ where: eq(schema.businesses.id, kit.B) }))!;
    await withTenant(kit.A, async (tx) => {
      locationId = (await tx.insert(schema.locations).values({ businessId: kit.A, name: "Main", isDefault: true }).returning())[0]!.id;
      clientId = (await tx.insert(schema.clients).values({ businessId: kit.A, firstName: "Maria", lastName: "Lopez", email: "maria@kit.test" }).returning())[0]!.id;
      staffId = (await tx.insert(schema.staff).values({ businessId: kit.A, displayName: "Ava" }).returning())[0]!.id;
      serviceId = (await tx.insert(schema.services).values({ businessId: kit.A, name: "Bridal hair", durationMin: 90, priceCents: 25_000 }).returning())[0]!.id;
      productId = (await tx.insert(schema.products).values({ businessId: kit.A, name: "Hairspray", priceCents: 2000, kind: "retail", taxable: true, trackStock: true, stockQty: 5 }).returning())[0]!.id;
      await tx.insert(schema.productStock).values({ businessId: kit.A, productId, locationId, qty: 5 });
    });
  });
  afterAll(async () => {
    await kit?.teardown();
    if (userId) await db.delete(schema.user).where(eq(schema.user.id, userId));
  });

  const input = (o: Partial<Parameters<typeof inv.createInvoice>[1]> = {}): Parameters<typeof inv.createInvoice>[1] => ({
    clientId,
    locationId: null,
    lines: [
      { kind: "service", serviceId, staffId, priceCents: null },
      { kind: "product", productId, quantity: 2, staffId: null },
      { kind: "custom", name: "Travel to venue", unitCents: 5000, quantity: 1, taxable: false, staffId },
    ],
    discount: { type: "percent", value: 10 },
    taxExempt: false,
    dueOn: "2026-11-10",
    note: "See you on the big day",
    deposit: { type: "percent", value: 50 },
    remind: true,
    ...o,
  });
  const notes = (template: string) => withTenant(kit.A, (tx) => tx.select().from(schema.notifications).where(eq(schema.notifications.template, template)));

  it("prices the lines like a ticket: discount spread over taxable lines, tax at the location's rate", async () => {
    const id = await inv.createInvoice(business, input(), userId);
    const d = (await inv.getInvoice(kit.A, id))!;
    // 250 + 2×20 + 50 = 340; 10% off = 34; tax on the products' 40 less their share of the discount (4) = 36 × 6% = 2.16.
    expect([d.sale.subtotalCents, d.sale.discountCents, d.sale.taxCents, d.sale.totalCents]).toEqual([34_000, 3400, 216, 30_816]);
    expect(d.sale.status).toBe("open");
    expect(d.sale.source).toBe("invoice");
    expect(d.lines.map((l) => [l.kind, l.name, l.staffId])).toEqual([["service", "Bridal hair", staffId], ["product", "Hairspray", null], ["service", "Travel to venue", staffId]]);
    expect(d.invoice.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(d.invoice.status).toBe("draft");
    await expect(inv.createInvoice(business, input({ lines: [{ kind: "custom", name: "Nothing", unitCents: 0, quantity: 1, taxable: false, staffId: null }] }), userId)).rejects.toThrow(/at least \$1/);
  });

  it("keeps the link private: a draft, a wrong or malformed token, or another salon's address opens nothing", async () => {
    const id = await inv.createInvoice(business, input(), userId);
    const d = (await inv.getInvoice(kit.A, id))!;
    expect(await inv.invoiceByToken(business, d.invoice.token)).toBeNull(); // not sent yet
    await inv.sendInvoice(business, id, { email: "maria@kit.test", phone: null }, userId);
    expect((await inv.invoiceByToken(business, d.invoice.token))?.invoice.id).toBe(id);
    expect(await inv.invoiceByToken(businessB, d.invoice.token)).toBeNull();
    expect(await inv.invoiceByToken(business, `${d.invoice.token.slice(0, 42)}x`)).toBeNull();
    expect(await inv.invoiceByToken(business, "' or 1=1 --")).toBeNull();
    // Every invoice gets its own random token.
    const other = (await inv.getInvoice(kit.A, await inv.createInvoice(business, input(), userId)))!;
    expect(other.invoice.token).not.toBe(d.invoice.token);
    const mail = (await notes("invoice")).find((x) => x.recipient === "maria@kit.test" && x.body.includes(d.invoice.token));
    expect(mail?.subject).toContain(`Invoice #${d.sale.number}`);
  });

  it("takes a check, then the rest by card: one paid sale, stock taken, each receipt once", async () => {
    const id = await inv.createInvoice(business, input(), userId);
    await inv.sendInvoice(business, id, { email: "maria@kit.test", phone: null }, userId);
    const token = (await inv.getInvoice(kit.A, id))!.invoice.token;
    // Below the deposit (50% of 308.16 = 154.08) online is refused.
    await expect(inv.startInvoicePayment(business, token, 10_000)).rejects.toThrow(/deposit/);
    await inv.recordInvoicePayment(business, id, { method: "check", amountCents: 15_408, checkNumber: "1042" }, userId);
    let d = (await inv.getInvoice(kit.A, id))!;
    expect(d.sale.status).toBe("open");
    expect(invoiceState(d.invoice, d.sale, "2026-11-01")).toBe("partly_paid");
    expect(d.payments.map((p) => [p.method, p.note, p.amountCents])).toEqual([["other", "Check #1042", 15_408]]);
    // An unpaid invoice stays off the open tickets list.
    expect((await listSales(kit.A, { status: "open" })).rows.some((r) => r.sale.id === d.sale.id)).toBe(false);

    // The rest by card: more than the balance is refused, the balance goes through.
    await expect(inv.startInvoicePayment(business, token, 99_999)).rejects.toThrow(/to \$154\.08/);
    const start = await inv.startInvoicePayment(business, token, 15_408);
    expect(start.provider).toBe("stripe");
    const pi = intents.get(start.intentId)!;
    expect(pi.metadata).toMatchObject({ kind: "invoice", saleId: d.sale.id, businessId: kit.A });
    pi.status = "succeeded";
    pi.latest_charge = { id: "ch_inv", payment_method_details: { card: { brand: "visa", last4: "4242" } } };
    await inv.finishInvoicePayment(business, token, pi.id);
    await inv.finishInvoicePayment(business, token, pi.id); // the page retried
    await inv.invoicePaidByWebhook(business, d.sale.id); // and the webhook came too

    d = (await inv.getInvoice(kit.A, id))!;
    expect(d.sale.status).toBe("paid");
    expect(d.sale.paidCents).toBe(30_816);
    expect(d.sale.closedAt).not.toBeNull();
    expect(d.invoice.paidAt).not.toBeNull();
    expect(invoiceState(d.invoice, d.sale, "2026-12-01")).toBe("paid");
    expect(d.payments.filter((p) => p.status === "succeeded").map((p) => [p.method, p.cardLast4])).toEqual([["other", null], ["card", "4242"]]);
    // Paid off: the product left stock like any sale, and the sale is in the closed list.
    const [stock] = await withTenant(kit.A, (tx) => tx.select().from(schema.productStock).where(and(eq(schema.productStock.productId, productId), eq(schema.productStock.locationId, locationId))));
    expect(stock!.qty).toBe(3);
    expect((await listSales(kit.A, { status: "closed" })).rows.some((r) => r.sale.id === d.sale.id)).toBe(true);
    // Receipts: "payment received" for the check, the full receipt for the card payment that paid it off, and one note to the salon.
    const mine = async (t: string) => (await notes(t)).filter((x) => x.body.includes(`#${d.sale.number}`));
    expect((await mine("invoice_payment")).length).toBe(1);
    expect((await mine("receipt")).length).toBe(1);
    expect((await notes("staff_invoice_paid")).filter((x) => x.subject?.includes(`#${d.sale.number}`)).length).toBe(1);
    // A paid invoice can't be voided, edited or paid again.
    await expect(inv.voidInvoice(business, id, userId)).rejects.toThrow(/paid/);
    await expect(inv.updateInvoice(business, id, input(), userId)).rejects.toThrow(/paid/);
    await expect(inv.startInvoicePayment(business, token, 100)).rejects.toThrow(/already paid/);
  });

  it("voids an unpaid invoice with its sale; a part-paid one must be refunded first", async () => {
    const id = await inv.createInvoice(business, input({ deposit: null }), userId);
    await inv.voidInvoice(business, id, userId);
    const d = (await inv.getInvoice(kit.A, id))!;
    expect([d.invoice.status, d.sale.status]).toEqual(["void", "void"]);
    const id2 = await inv.createInvoice(business, input({ deposit: null }), userId);
    await inv.recordInvoicePayment(business, id2, { method: "cash", amountCents: 1000, checkNumber: null }, userId);
    await expect(inv.voidInvoice(business, id2, userId)).rejects.toThrow(/Refund/);
  });

  it("lists by status with the same rule as the page, and remembers what is owed", async () => {
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: business.timezone }).format(new Date());
    const late = await inv.createInvoice(business, input({ dueOn: "2020-01-01", deposit: null }), userId);
    await inv.sendInvoice(business, late, { email: "maria@kit.test", phone: null }, userId);
    const all = await inv.listInvoices(business, {});
    for (const r of all.rows) expect(r.state).toBe(invoiceState(r.invoice, r.sale, today));
    const overdue = await inv.listInvoices(business, { state: "overdue" });
    expect(overdue.rows.map((r) => r.invoice.id)).toContain(late);
    expect(overdue.rows.every((r) => r.state === "overdue")).toBe(true);
    expect(all.overdueCents).toBeGreaterThanOrEqual(30_816);
    expect((await inv.listInvoices(business, { state: "paid" })).rows.every((r) => r.sale.status === "paid")).toBe(true);
  });

  it("sends each reminder once, by the channel it went out on", async () => {
    const id = await inv.createInvoice(business, input({ dueOn: "2026-11-10", deposit: null }), userId);
    await inv.sendInvoice(business, id, { email: "maria@kit.test", phone: "+15555550123" }, userId);
    await withTenant(kit.A, (tx) => tx.update(schema.invoices).set({ sentAt: new Date("2026-11-01T15:00:00Z") }).where(eq(schema.invoices.id, id)));
    const noon = new Date("2026-11-11T17:00:00Z"); // noon in New York, the day after it was due
    const r1 = await inv.sendInvoiceReminders({ now: noon, businessIds: [kit.A] });
    const r2 = await inv.sendInvoiceReminders({ now: noon, businessIds: [kit.A] });
    expect(r1.sent).toBeGreaterThanOrEqual(1);
    expect(r2.sent).toBe(0);
    const d = (await inv.getInvoice(kit.A, id))!;
    expect([...d.invoice.remindersSent].sort()).toEqual(["after_1", "before", "due"]);
    const rem = (await notes("invoice_reminder")).filter((x) => x.body.includes(d.invoice.token));
    expect(rem.map((x) => x.channel).sort()).toEqual(["email", "sms"]);
    expect(rem.find((x) => x.channel === "email")?.subject).toMatch(/Past due/);
    // Overnight in the business's time zone: nothing goes out.
    await withTenant(kit.A, (tx) => tx.update(schema.invoices).set({ remindersSent: sql`'{}'::text[]` }).where(eq(schema.invoices.id, id)));
    expect((await inv.sendInvoiceReminders({ now: new Date("2026-11-11T06:00:00Z"), businessIds: [kit.A] })).checked).toBe(0);
  });
});
