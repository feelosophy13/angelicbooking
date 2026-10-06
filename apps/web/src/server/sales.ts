import { and, asc, desc, eq, gte, lt, sql } from "drizzle-orm";
import { schema, withTenant, type TenantDb } from "@angelic/db";
import { allocateProportionally, computeTotals, type Discount } from "@angelic/core";
import { platformFeeBps, stripe } from "@/lib/stripe";
import { ensureStripeCustomer } from "./stripe-connect";

export class SaleError extends Error {}

type Sale = typeof schema.sales.$inferSelect;
type Line = typeof schema.saleLines.$inferSelect;

async function audit(tx: TenantDb, businessId: string, actorUserId: string, action: string, entityId: string, diff?: unknown) {
  await tx.insert(schema.auditLog).values({
    businessId,
    actorUserId,
    action,
    entity: "sale",
    entityId,
    diff: diff === undefined ? null : JSON.stringify(diff),
  });
}

/** Recompute stored totals from lines + discount. Call after any line change. */
async function recompute(tx: TenantDb, saleId: string, taxRateBps: number, discount: Discount | null, discountNote?: string | null) {
  const lines = await tx.select().from(schema.saleLines).where(eq(schema.saleLines.saleId, saleId));
  const t = computeTotals(
    lines.map((l) => ({ kind: l.kind, amountCents: l.amountCents, taxable: l.taxable, staffId: l.staffId })),
    discount,
    taxRateBps,
  );
  const [paid] = await tx
    .select({
      paid: sql<number>`coalesce(sum(${schema.payments.amountCents}) filter (where ${schema.payments.status} in ('succeeded','partially_refunded','refunded')), 0)`,
      refunded: sql<number>`coalesce(sum(${schema.payments.refundedCents}), 0)`,
    })
    .from(schema.payments)
    .where(eq(schema.payments.saleId, saleId));
  const paidCents = Number(paid?.paid ?? 0);
  const refundedCents = Number(paid?.refunded ?? 0);
  await tx
    .update(schema.sales)
    .set({
      subtotalCents: t.subtotalCents,
      discountCents: t.discountCents,
      taxCents: t.taxCents,
      tipCents: t.tipCents,
      totalCents: t.totalCents,
      paidCents,
      refundedCents,
      ...(discountNote !== undefined ? { discountNote } : {}),
    })
    .where(eq(schema.sales.id, saleId));
  return { ...t, paidCents, refundedCents };
}

/** Open (or return the existing) sale for an appointment, seeded with its live services. */
export async function openSaleForAppointment(input: { businessId: string; appointmentId: string; actorUserId: string; taxRateBps: number; currency: string }) {
  return withTenant(input.businessId, async (tx) => {
    const existing = await tx.query.sales.findFirst({ where: eq(schema.sales.appointmentId, input.appointmentId) });
    if (existing) return existing.id;
    const appt = await tx.query.appointments.findFirst({ where: eq(schema.appointments.id, input.appointmentId) });
    if (!appt) throw new SaleError("Appointment not found.");
    const items = await tx
      .select()
      .from(schema.appointmentItems)
      .where(and(eq(schema.appointmentItems.appointmentId, input.appointmentId), sql`${schema.appointmentItems.status} <> 'cancelled'`))
      .orderBy(asc(schema.appointmentItems.sortOrder));
    const rows = await tx.execute<{ n: number }>(sql`select next_sale_number(${input.businessId}) as n`);
    const n = Number(rows[0]?.n ?? 1001);
    const [sale] = await tx
      .insert(schema.sales)
      .values({
        businessId: input.businessId,
        number: n,
        appointmentId: appt.id,
        clientId: appt.clientId,
        currency: input.currency,
        createdByUserId: input.actorUserId,
      })
      .returning();
    const serviceItems = items.filter((i) => i.priceCents > 0 || i.sortOrder === 0);
    if (serviceItems.length) {
      await tx.insert(schema.saleLines).values(
        serviceItems.map((i, idx) => ({
          businessId: input.businessId,
          saleId: sale!.id,
          kind: "service" as const,
          staffId: i.staffId,
          serviceId: i.serviceId,
          appointmentItemId: i.id,
          name: i.serviceName.replace(" (finish)", ""),
          quantity: 1,
          unitCents: i.priceCents,
          amountCents: i.priceCents,
          taxable: false,
          sortOrder: idx,
        })),
      );
    }
    await recompute(tx, sale!.id, input.taxRateBps, null);
    await audit(tx, input.businessId, input.actorUserId, "sale.open", sale!.id, { appointmentId: appt.id });
    return sale!.id;
  });
}

export async function getSale(businessId: string, saleId: string) {
  return withTenant(businessId, async (tx) => {
    const sale = await tx.query.sales.findFirst({ where: eq(schema.sales.id, saleId) });
    if (!sale) return null;
    const [lines, pays, client, staffRows, products] = await Promise.all([
      tx.select().from(schema.saleLines).where(eq(schema.saleLines.saleId, saleId)).orderBy(asc(schema.saleLines.sortOrder), asc(schema.saleLines.id)),
      tx.select().from(schema.payments).where(eq(schema.payments.saleId, saleId)).orderBy(asc(schema.payments.createdAt)),
      sale.clientId ? tx.query.clients.findFirst({ where: eq(schema.clients.id, sale.clientId) }) : Promise.resolve(null),
      tx.select().from(schema.staff).where(eq(schema.staff.active, true)).orderBy(asc(schema.staff.displayName)),
      tx.select().from(schema.products).where(eq(schema.products.active, true)).orderBy(asc(schema.products.name)),
    ]);
    const refunds = pays.length
      ? await tx.select().from(schema.refunds).where(sql`${schema.refunds.paymentId} in ${pays.map((p) => p.id)}`)
      : [];
    return { sale, lines, payments: pays, refunds, client: client ?? null, staff: staffRows, products };
  });
}

function assertOpen(sale: Sale) {
  if (sale.status !== "open") throw new SaleError(`This sale is ${sale.status}.`);
}

export async function addProductLine(input: { businessId: string; saleId: string; productId: string; quantity: number; staffId: string | null; actorUserId: string; taxRateBps: number }) {
  await withTenant(input.businessId, async (tx) => {
    const sale = await tx.query.sales.findFirst({ where: eq(schema.sales.id, input.saleId) });
    if (!sale) throw new SaleError("Sale not found.");
    assertOpen(sale);
    const product = await tx.query.products.findFirst({ where: eq(schema.products.id, input.productId) });
    if (!product || !product.active) throw new SaleError("Product not available.");
    const qty = Math.max(1, Math.min(99, Math.round(input.quantity)));
    await tx.insert(schema.saleLines).values({
      businessId: input.businessId,
      saleId: sale.id,
      kind: "product",
      staffId: input.staffId,
      productId: product.id,
      name: product.name,
      quantity: qty,
      unitCents: product.priceCents,
      amountCents: product.priceCents * qty,
      taxable: product.taxable,
      sortOrder: 100,
    });
    await recompute(tx, sale.id, input.taxRateBps, currentDiscount(sale));
  });
}

export async function removeLine(input: { businessId: string; saleId: string; lineId: string; taxRateBps: number }) {
  await withTenant(input.businessId, async (tx) => {
    const sale = await tx.query.sales.findFirst({ where: eq(schema.sales.id, input.saleId) });
    if (!sale) throw new SaleError("Sale not found.");
    assertOpen(sale);
    await tx.delete(schema.saleLines).where(and(eq(schema.saleLines.id, input.lineId), eq(schema.saleLines.saleId, sale.id)));
    await recompute(tx, sale.id, input.taxRateBps, currentDiscount(sale));
  });
}

/** We persist the discount as cents; the UI may enter a percent which we resolve here. */
function currentDiscount(sale: Sale): Discount | null {
  return sale.discountCents > 0 ? { type: "amount", value: sale.discountCents } : null;
}

export async function setDiscount(input: { businessId: string; saleId: string; discount: Discount | null; note: string | null; taxRateBps: number }) {
  await withTenant(input.businessId, async (tx) => {
    const sale = await tx.query.sales.findFirst({ where: eq(schema.sales.id, input.saleId) });
    if (!sale) throw new SaleError("Sale not found.");
    assertOpen(sale);
    await recompute(tx, sale.id, input.taxRateBps, input.discount, input.note);
  });
}

/** Replace tip lines. `tips` is per staff; an unassigned tip is split by service revenue. */
export async function setTips(input: { businessId: string; saleId: string; tips: { staffId: string | null; amountCents: number }[]; taxRateBps: number }) {
  await withTenant(input.businessId, async (tx) => {
    const sale = await tx.query.sales.findFirst({ where: eq(schema.sales.id, input.saleId) });
    if (!sale) throw new SaleError("Sale not found.");
    assertOpen(sale);
    await tx.delete(schema.saleLines).where(and(eq(schema.saleLines.saleId, sale.id), eq(schema.saleLines.kind, "tip")));
    const serviceLines = await tx
      .select()
      .from(schema.saleLines)
      .where(and(eq(schema.saleLines.saleId, sale.id), eq(schema.saleLines.kind, "service")));
    const byStaff = new Map<string, number>();
    for (const t of input.tips) {
      if (t.amountCents <= 0) continue;
      if (t.staffId) byStaff.set(t.staffId, (byStaff.get(t.staffId) ?? 0) + t.amountCents);
      else {
        const weights = [...new Set(serviceLines.map((l) => l.staffId).filter((x): x is string => !!x))].map((key) => ({
          key,
          weight: serviceLines.filter((l) => l.staffId === key).reduce((s, l) => s + l.amountCents, 0),
        }));
        const split = allocateProportionally(t.amountCents, weights);
        for (const [k, v] of Object.entries(split)) byStaff.set(k, (byStaff.get(k) ?? 0) + v);
      }
    }
    if (byStaff.size) {
      await tx.insert(schema.saleLines).values(
        [...byStaff.entries()].map(([staffId, amountCents]) => ({
          businessId: input.businessId,
          saleId: sale.id,
          kind: "tip" as const,
          staffId,
          name: "Tip",
          quantity: 1,
          unitCents: amountCents,
          amountCents,
          taxable: false,
          sortOrder: 900,
        })),
      );
    }
    await recompute(tx, sale.id, input.taxRateBps, currentDiscount(sale));
  });
}

function balance(sale: Sale) {
  return sale.totalCents - sale.paidCents;
}

/** Tip portion of a payment: proportional share of the sale's tip. */
function tipShare(sale: Sale, amountCents: number) {
  if (sale.totalCents <= 0 || sale.tipCents <= 0) return 0;
  return Math.min(sale.tipCents, Math.round((sale.tipCents * amountCents) / sale.totalCents));
}

async function closeIfPaid(tx: TenantDb, saleId: string, taxRateBps: number, actorUserId: string, businessId: string) {
  const sale = await tx.query.sales.findFirst({ where: eq(schema.sales.id, saleId) });
  if (!sale) return;
  const t = await recompute(tx, saleId, taxRateBps, currentDiscount(sale));
  if (t.paidCents >= t.totalCents && sale.status === "open") {
    await tx.update(schema.sales).set({ status: "paid", closedAt: new Date() }).where(eq(schema.sales.id, saleId));
    if (sale.appointmentId) {
      await tx.update(schema.appointments).set({ status: "completed" }).where(eq(schema.appointments.id, sale.appointmentId));
      await tx
        .update(schema.appointmentItems)
        .set({ status: "completed" })
        .where(and(eq(schema.appointmentItems.appointmentId, sale.appointmentId), sql`${schema.appointmentItems.status} <> 'cancelled'`));
    }
    await audit(tx, businessId, actorUserId, "sale.paid", saleId, { total: t.totalCents });
  }
}

/** Cash / other (external) payment. */
export async function recordManualPayment(input: {
  businessId: string;
  saleId: string;
  method: "cash" | "other";
  amountCents: number;
  note: string | null;
  actorUserId: string;
  taxRateBps: number;
}) {
  await withTenant(input.businessId, async (tx) => {
    const sale = await tx.query.sales.findFirst({ where: eq(schema.sales.id, input.saleId) });
    if (!sale) throw new SaleError("Sale not found.");
    assertOpen(sale);
    const due = balance(sale);
    if (input.amountCents <= 0) throw new SaleError("Enter an amount.");
    const amount = Math.min(input.amountCents, due);
    if (amount <= 0) throw new SaleError("Nothing left to pay.");
    await tx.insert(schema.payments).values({
      businessId: input.businessId,
      saleId: sale.id,
      method: input.method,
      status: "succeeded",
      amountCents: amount,
      tipCents: tipShare(sale, amount),
      note: input.note,
      createdByUserId: input.actorUserId,
    });
    await audit(tx, input.businessId, input.actorUserId, `payment.${input.method}`, sale.id, { amount });
    await closeIfPaid(tx, sale.id, input.taxRateBps, input.actorUserId, input.businessId);
  });
}

/**
 * Charge a saved card (off-session) on the business's Stripe account.
 * Money goes straight to the business; an optional platform fee is taken.
 */
export async function chargeCardOnFile(input: {
  businessId: string;
  accountId: string;
  saleId: string;
  paymentMethodId: string;
  amountCents: number;
  actorUserId: string;
  taxRateBps: number;
}) {
  return withTenant(input.businessId, async (tx) => {
    const sale = await tx.query.sales.findFirst({ where: eq(schema.sales.id, input.saleId) });
    if (!sale) throw new SaleError("Sale not found.");
    assertOpen(sale);
    if (!sale.clientId) throw new SaleError("Attach a client to use a saved card.");
    const client = await tx.query.clients.findFirst({ where: eq(schema.clients.id, sale.clientId) });
    if (!client) throw new SaleError("Client not found.");
    const amount = Math.min(input.amountCents, balance(sale));
    if (amount < 50) throw new SaleError("Amount must be at least $0.50.");
    const customerId = await ensureStripeCustomer({ accountId: input.accountId, businessId: input.businessId, client, tx });
    const fee = Math.round((amount * platformFeeBps()) / 10_000);
    const [pending] = await tx
      .insert(schema.payments)
      .values({
        businessId: input.businessId,
        saleId: sale.id,
        method: "card_on_file",
        status: "pending",
        amountCents: amount,
        tipCents: tipShare(sale, amount),
        createdByUserId: input.actorUserId,
      })
      .returning();
    let pi;
    try {
      pi = await stripe().paymentIntents.create(
        {
          amount,
          currency: sale.currency,
          customer: customerId,
          payment_method: input.paymentMethodId,
          off_session: true,
          confirm: true,
          description: `Sale #${sale.number}`,
          metadata: { businessId: input.businessId, saleId: sale.id, paymentId: pending!.id },
          ...(fee > 0 ? { application_fee_amount: fee } : {}),
        },
        { stripeAccount: input.accountId, idempotencyKey: `pay_${pending!.id}` },
      );
    } catch (e) {
      await tx.update(schema.payments).set({ status: "failed", note: (e as Error).message }).where(eq(schema.payments.id, pending!.id));
      throw new SaleError(`Card declined: ${(e as Error).message}`);
    }
    const charge = typeof pi.latest_charge === "object" ? pi.latest_charge : null;
    await tx
      .update(schema.payments)
      .set({
        status: pi.status === "succeeded" ? "succeeded" : "pending",
        stripePaymentIntentId: pi.id,
        stripeChargeId: charge?.id ?? (typeof pi.latest_charge === "string" ? pi.latest_charge : null),
      })
      .where(eq(schema.payments.id, pending!.id));
    await audit(tx, input.businessId, input.actorUserId, "payment.card_on_file", sale.id, { amount, pi: pi.id });
    if (pi.status === "succeeded") await closeIfPaid(tx, sale.id, input.taxRateBps, input.actorUserId, input.businessId);
    return pi.status;
  });
}

/** Create a PaymentIntent for a new card entered in the browser (Payment Element). */
export async function createCardPaymentIntent(input: {
  businessId: string;
  accountId: string;
  saleId: string;
  amountCents: number;
  saveCard: boolean;
  actorUserId: string;
}) {
  return withTenant(input.businessId, async (tx) => {
    const sale = await tx.query.sales.findFirst({ where: eq(schema.sales.id, input.saleId) });
    if (!sale) throw new SaleError("Sale not found.");
    assertOpen(sale);
    const amount = Math.min(input.amountCents, balance(sale));
    if (amount < 50) throw new SaleError("Amount must be at least $0.50.");
    let customerId: string | undefined;
    if (sale.clientId) {
      const client = await tx.query.clients.findFirst({ where: eq(schema.clients.id, sale.clientId) });
      if (client) customerId = await ensureStripeCustomer({ accountId: input.accountId, businessId: input.businessId, client, tx });
    }
    const [pending] = await tx
      .insert(schema.payments)
      .values({
        businessId: input.businessId,
        saleId: sale.id,
        method: "card",
        status: "pending",
        amountCents: amount,
        tipCents: tipShare(sale, amount),
        createdByUserId: input.actorUserId,
      })
      .returning();
    const fee = Math.round((amount * platformFeeBps()) / 10_000);
    const pi = await stripe().paymentIntents.create(
      {
        amount,
        currency: sale.currency,
        customer: customerId,
        description: `Sale #${sale.number}`,
        automatic_payment_methods: { enabled: true },
        ...(input.saveCard && customerId ? { setup_future_usage: "off_session" as const } : {}),
        metadata: { businessId: input.businessId, saleId: sale.id, paymentId: pending!.id },
        ...(fee > 0 ? { application_fee_amount: fee } : {}),
      },
      { stripeAccount: input.accountId, idempotencyKey: `pi_${pending!.id}` },
    );
    await tx.update(schema.payments).set({ stripePaymentIntentId: pi.id }).where(eq(schema.payments.id, pending!.id));
    return { clientSecret: pi.client_secret!, paymentId: pending!.id, amount };
  });
}

/** Called by the webhook (or a return URL) when Stripe says a PaymentIntent succeeded. */
export async function markCardPaymentSucceeded(input: {
  businessId: string;
  paymentIntentId: string;
  chargeId: string | null;
  card: { brand: string | null; last4: string | null };
  taxRateBps: number;
}) {
  await withTenant(input.businessId, async (tx) => {
    const p = await tx.query.payments.findFirst({ where: eq(schema.payments.stripePaymentIntentId, input.paymentIntentId) });
    if (!p || p.status === "succeeded") return;
    await tx
      .update(schema.payments)
      .set({ status: "succeeded", stripeChargeId: input.chargeId, cardBrand: input.card.brand, cardLast4: input.card.last4 })
      .where(eq(schema.payments.id, p.id));
    await closeIfPaid(tx, p.saleId, input.taxRateBps, p.createdByUserId ?? "system", input.businessId);
  });
}

export async function markCardPaymentFailed(businessId: string, paymentIntentId: string, reason: string | null) {
  await withTenant(businessId, async (tx) => {
    await tx
      .update(schema.payments)
      .set({ status: "failed", note: reason })
      .where(and(eq(schema.payments.stripePaymentIntentId, paymentIntentId), eq(schema.payments.status, "pending")));
  });
}

export async function refundPayment(input: {
  businessId: string;
  accountId: string | null;
  paymentId: string;
  amountCents: number;
  reason: string | null;
  actorUserId: string;
  taxRateBps: number;
}) {
  await withTenant(input.businessId, async (tx) => {
    const p = await tx.query.payments.findFirst({ where: eq(schema.payments.id, input.paymentId) });
    if (!p) throw new SaleError("Payment not found.");
    const refundable = p.amountCents - p.refundedCents;
    const amount = Math.min(input.amountCents, refundable);
    if (amount <= 0) throw new SaleError("Nothing left to refund.");
    let stripeRefundId: string | null = null;
    if (p.stripePaymentIntentId) {
      if (!input.accountId) throw new SaleError("Stripe account not connected.");
      const r = await stripe().refunds.create(
        { payment_intent: p.stripePaymentIntentId, amount, reason: "requested_by_customer", metadata: { paymentId: p.id } },
        { stripeAccount: input.accountId, idempotencyKey: `rf_${p.id}_${p.refundedCents + amount}` },
      );
      stripeRefundId = r.id;
    }
    await tx.insert(schema.refunds).values({
      businessId: input.businessId,
      paymentId: p.id,
      amountCents: amount,
      reason: input.reason,
      stripeRefundId,
      createdByUserId: input.actorUserId,
    });
    const newRefunded = p.refundedCents + amount;
    await tx
      .update(schema.payments)
      .set({ refundedCents: newRefunded, status: newRefunded >= p.amountCents ? "refunded" : "partially_refunded" })
      .where(eq(schema.payments.id, p.id));
    const sale = (await tx.query.sales.findFirst({ where: eq(schema.sales.id, p.saleId) }))!;
    const t = await recompute(tx, sale.id, input.taxRateBps, currentDiscount(sale));
    if (t.refundedCents >= t.paidCents && t.paidCents > 0) {
      await tx.update(schema.sales).set({ status: "refunded" }).where(eq(schema.sales.id, sale.id));
    }
    await audit(tx, input.businessId, input.actorUserId, "payment.refund", sale.id, { paymentId: p.id, amount });
  });
}

export async function voidSale(input: { businessId: string; saleId: string; actorUserId: string }) {
  await withTenant(input.businessId, async (tx) => {
    const sale = await tx.query.sales.findFirst({ where: eq(schema.sales.id, input.saleId) });
    if (!sale) throw new SaleError("Sale not found.");
    if (sale.paidCents > 0) throw new SaleError("Refund payments before voiding.");
    await tx.update(schema.sales).set({ status: "void", closedAt: new Date() }).where(eq(schema.sales.id, sale.id));
    await audit(tx, input.businessId, input.actorUserId, "sale.void", sale.id);
  });
}

/** Sales summary for a local-date range: by day, by staff, by payment method. */
export async function salesReport(businessId: string, from: Date, to: Date) {
  return withTenant(businessId, async (tx) => {
    const closed = and(gte(schema.sales.closedAt, from), lt(schema.sales.closedAt, to), sql`${schema.sales.status} in ('paid','refunded')`);
    const [sales, byStaff, byMethod] = await Promise.all([
      tx
        .select({
          id: schema.sales.id,
          number: schema.sales.number,
          closedAt: schema.sales.closedAt,
          clientId: schema.sales.clientId,
          clientFirst: schema.clients.firstName,
          clientLast: schema.clients.lastName,
          status: schema.sales.status,
          subtotalCents: schema.sales.subtotalCents,
          discountCents: schema.sales.discountCents,
          taxCents: schema.sales.taxCents,
          tipCents: schema.sales.tipCents,
          totalCents: schema.sales.totalCents,
          refundedCents: schema.sales.refundedCents,
        })
        .from(schema.sales)
        .leftJoin(schema.clients, eq(schema.clients.id, schema.sales.clientId))
        .where(closed)
        .orderBy(desc(schema.sales.closedAt)),
      tx
        .select({
          staffId: schema.saleLines.staffId,
          staffName: schema.staff.displayName,
          services: sql<number>`coalesce(sum(${schema.saleLines.amountCents}) filter (where ${schema.saleLines.kind} = 'service'), 0)`,
          products: sql<number>`coalesce(sum(${schema.saleLines.amountCents}) filter (where ${schema.saleLines.kind} = 'product'), 0)`,
          tips: sql<number>`coalesce(sum(${schema.saleLines.amountCents}) filter (where ${schema.saleLines.kind} = 'tip'), 0)`,
        })
        .from(schema.saleLines)
        .innerJoin(schema.sales, eq(schema.sales.id, schema.saleLines.saleId))
        .leftJoin(schema.staff, eq(schema.staff.id, schema.saleLines.staffId))
        .where(closed)
        .groupBy(schema.saleLines.staffId, schema.staff.displayName),
      tx
        .select({
          method: schema.payments.method,
          amount: sql<number>`coalesce(sum(${schema.payments.amountCents}), 0)`,
          tips: sql<number>`coalesce(sum(${schema.payments.tipCents}), 0)`,
          refunded: sql<number>`coalesce(sum(${schema.payments.refundedCents}), 0)`,
          count: sql<number>`count(*)`,
        })
        .from(schema.payments)
        .innerJoin(schema.sales, eq(schema.sales.id, schema.payments.saleId))
        .where(and(closed, sql`${schema.payments.status} in ('succeeded','partially_refunded','refunded')`))
        .groupBy(schema.payments.method),
    ]);
    const [byService, appts] = await Promise.all([
      tx
        .select({
          name: schema.saleLines.name,
          kind: schema.saleLines.kind,
          count: sql<number>`count(*)`,
          amount: sql<number>`coalesce(sum(${schema.saleLines.amountCents}), 0)`,
        })
        .from(schema.saleLines)
        .innerJoin(schema.sales, eq(schema.sales.id, schema.saleLines.saleId))
        .where(and(closed, sql`${schema.saleLines.kind} in ('service','product')`))
        .groupBy(schema.saleLines.name, schema.saleLines.kind)
        .orderBy(sql`sum(${schema.saleLines.amountCents}) desc`)
        .limit(25),
      tx
        .select({ status: schema.appointments.status, source: schema.appointments.source, count: sql<number>`count(*)` })
        .from(schema.appointments)
        .innerJoin(schema.appointmentItems, eq(schema.appointmentItems.appointmentId, schema.appointments.id))
        .where(and(gte(schema.appointmentItems.startAt, from), lt(schema.appointmentItems.startAt, to), eq(schema.appointmentItems.sortOrder, 0)))
        .groupBy(schema.appointments.status, schema.appointments.source),
    ]);
    return { sales, byStaff, byMethod, byService, appts };
  });
}
