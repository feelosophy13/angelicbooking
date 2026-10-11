import { and, asc, desc, eq, gt, gte, lt, sql } from "drizzle-orm";
import { schema, withTenant, type TenantDb } from "@angelic/db";
import { allocateProportionally, computeTotals, type Discount } from "@angelic/core";
import { after } from "next/server";
import { db } from "@angelic/db";
import { platformFeeBps, stripe } from "@/lib/stripe";
import { ensureStripeCustomer } from "./stripe-connect";
import { fulfilOfferLines, restoreCreditForLine } from "./offers";
import { awardPointsForSale } from "./loyalty";
import { triggerAppointmentWorkflows } from "./workflows";
import { decrementStockForSale } from "./inventory";
import { countPromoUse, promoDiscount, validatePromo, PromoError } from "./promos";
import { locationOrDefault } from "./locations";

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

/** The tax rate for a sale: its location's own rate when set, else the business default passed in. */
async function taxRateForSale(tx: TenantDb, saleId: string, businessDefaultBps: number): Promise<number> {
  const [row] = await tx
    .select({ bps: schema.locations.taxRateBps })
    .from(schema.sales)
    .innerJoin(schema.locations, eq(schema.locations.id, schema.sales.locationId))
    .where(eq(schema.sales.id, saleId));
  return row?.bps ?? businessDefaultBps;
}

/** Recompute stored totals from lines + discount. Call after any line change. `taxRateBps` is the business default; the sale's location may override it. */
async function recompute(tx: TenantDb, saleId: string, taxRateBps: number, discount: Discount | null, discountNote?: string | null) {
  const lines = await tx.select().from(schema.saleLines).where(eq(schema.saleLines.saleId, saleId));
  const t = computeTotals(
    lines.map((l) => ({ kind: l.kind, amountCents: l.amountCents, taxable: l.taxable, staffId: l.staffId, serviceId: l.serviceId })),
    discount,
    await taxRateForSale(tx, saleId, taxRateBps),
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
    // A voided ticket is history; the visit can be rung up again.
    const existing = await tx.query.sales.findFirst({ where: and(eq(schema.sales.appointmentId, input.appointmentId), sql`${schema.sales.status} <> 'void'`), orderBy: desc(schema.sales.createdAt) });
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
    // The money is taken where the appointment happens; walk-ins without a location use the default site.
    const location = await locationOrDefault(tx, appt.locationId);
    const [sale] = await tx
      .insert(schema.sales)
      .values({
        businessId: input.businessId,
        number: n,
        appointmentId: appt.id,
        locationId: location?.id ?? null,
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
    // A deposit paid at online booking becomes the first payment on the ticket.
    if (appt.depositStatus === "paid" && appt.depositCents > 0) {
      const m = /^([A-Z]+) •••• (\d{4})$/.exec(appt.depositCardLabel ?? "");
      await tx.insert(schema.payments).values({
        businessId: input.businessId,
        saleId: sale!.id,
        method: "card",
        status: "succeeded",
        amountCents: appt.depositCents,
        tipCents: 0,
        stripePaymentIntentId: appt.depositPaymentIntentId,
        cardBrand: m?.[1]?.toLowerCase() ?? null,
        cardLast4: m?.[2] ?? null,
        note: "Deposit paid online",
        createdByUserId: input.actorUserId,
      });
      await tx.update(schema.appointments).set({ depositStatus: "applied" }).where(eq(schema.appointments.id, appt.id));
    }
    // A promo code typed at online booking becomes the ticket's discount (if it still applies).
    let discount: Discount | null = null;
    if (appt.promoCodeId) {
      const promo = await tx.query.promoCodes.findFirst({ where: eq(schema.promoCodes.id, appt.promoCodeId) });
      if (promo) {
        try {
          await validatePromo(tx, promo.code, { serviceIds: serviceItems.map((i) => i.serviceId) });
          discount = promoDiscount(promo);
          await tx.update(schema.sales).set({ promoCodeId: promo.id, discountNote: `Code ${promo.code}` }).where(eq(schema.sales.id, sale!.id));
        } catch (e) {
          if (!(e instanceof PromoError)) throw e;
        }
      }
    }
    await recompute(tx, sale!.id, input.taxRateBps, discount);
    await audit(tx, input.businessId, input.actorUserId, "sale.open", sale!.id, { appointmentId: appt.id });
    return sale!.id;
  });
}

/** A ticket with no appointment: retail, a gift card at the desk, a walk-in rung up without booking. */
export async function openWalkInSale(input: { businessId: string; actorUserId: string; currency: string; clientId?: string | null; locationId?: string | null }) {
  return withTenant(input.businessId, async (tx) => {
    const rows = await tx.execute<{ n: number }>(sql`select next_sale_number(${input.businessId}) as n`);
    const n = Number(rows[0]?.n ?? 1001);
    const location = await locationOrDefault(tx, input.locationId ?? null);
    const [sale] = await tx
      .insert(schema.sales)
      .values({ businessId: input.businessId, number: n, locationId: location?.id ?? null, clientId: input.clientId ?? null, currency: input.currency, createdByUserId: input.actorUserId })
      .returning({ id: schema.sales.id });
    await audit(tx, input.businessId, input.actorUserId, "sale.open", sale!.id, { walkIn: true });
    return sale!.id;
  });
}

/** Attach (or change) the client on an open ticket so loyalty, saved cards and receipts work. */
export async function setSaleClient(input: { businessId: string; saleId: string; clientId: string | null; actorUserId: string }) {
  await withTenant(input.businessId, async (tx) => {
    const sale = await tx.query.sales.findFirst({ where: eq(schema.sales.id, input.saleId) });
    if (!sale) throw new SaleError("Sale not found.");
    assertOpen(sale);
    if (input.clientId) {
      const c = await tx.query.clients.findFirst({ where: eq(schema.clients.id, input.clientId), columns: { id: true } });
      if (!c) throw new SaleError("Client not found.");
    }
    await tx.update(schema.sales).set({ clientId: input.clientId }).where(eq(schema.sales.id, sale.id));
    await audit(tx, input.businessId, input.actorUserId, "sale.client", sale.id, { clientId: input.clientId });
  });
}

export type SalesListFilter = { status?: "open" | "closed" | "all"; q?: string; from?: Date; to?: Date; page?: number; pageSize?: number };

/** Tickets for the Sales page: open ones first, searchable by number or client, newest first. */
export async function listSales(businessId: string, f: SalesListFilter) {
  const page = Math.max(1, f.page ?? 1);
  const pageSize = Math.min(100, Math.max(10, f.pageSize ?? 50));
  const q = f.q?.trim() ?? "";
  return withTenant(businessId, async (tx) => {
    const conds = [];
    if (f.status === "open") conds.push(eq(schema.sales.status, "open"));
    if (f.status === "closed") conds.push(sql`${schema.sales.status} in ('paid','refunded','void')`);
    if (f.from) conds.push(gte(schema.sales.createdAt, f.from));
    if (f.to) conds.push(lt(schema.sales.createdAt, f.to));
    if (q) {
      const n = Number(q.replace(/^#/, ""));
      const like = `%${q}%`;
      conds.push(
        Number.isInteger(n)
          ? sql`(${schema.sales.number} = ${n} or ${schema.clients.firstName} ilike ${like} or ${schema.clients.lastName} ilike ${like})`
          : sql`(${schema.clients.firstName} ilike ${like} or ${schema.clients.lastName} ilike ${like} or (${schema.clients.firstName} || ' ' || ${schema.clients.lastName}) ilike ${like})`,
      );
    }
    const where = conds.length ? and(...conds) : undefined;
    const [rows, count] = await Promise.all([
      tx
        .select({ sale: schema.sales, clientFirst: schema.clients.firstName, clientLast: schema.clients.lastName, locationName: schema.locations.name })
        .from(schema.sales)
        .leftJoin(schema.clients, eq(schema.clients.id, schema.sales.clientId))
        .leftJoin(schema.locations, eq(schema.locations.id, schema.sales.locationId))
        .where(where)
        .orderBy(sql`case when ${schema.sales.status} = 'open' then 0 else 1 end`, desc(schema.sales.createdAt))
        .limit(pageSize)
        .offset((page - 1) * pageSize),
      tx.select({ n: sql<number>`count(*)` }).from(schema.sales).leftJoin(schema.clients, eq(schema.clients.id, schema.sales.clientId)).where(where),
    ]);
    return { rows, total: Number(count[0]?.n ?? 0), page, pageSize };
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
      tx
        .select({ id: schema.products.id, name: schema.products.name, priceCents: schema.products.priceCents, taxable: schema.products.taxable, category: schema.productCategories.name })
        .from(schema.products)
        .leftJoin(schema.productCategories, eq(schema.productCategories.id, schema.products.categoryId))
        .where(eq(schema.products.active, true))
        .orderBy(asc(schema.productCategories.sortOrder), asc(schema.productCategories.name), asc(schema.products.name)),
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
    await recompute(tx, sale.id, input.taxRateBps, await currentDiscount(tx, sale));
  });
}

/** Ring up a service that wasn't on the appointment (an upsell at the desk), at the service's price unless overridden. */
export async function addServiceLine(input: { businessId: string; saleId: string; serviceId: string; staffId: string | null; priceCents?: number | null; taxRateBps: number; actorUserId: string }) {
  await withTenant(input.businessId, async (tx) => {
    const sale = await tx.query.sales.findFirst({ where: eq(schema.sales.id, input.saleId) });
    if (!sale) throw new SaleError("Sale not found.");
    assertOpen(sale);
    const service = await tx.query.services.findFirst({ where: eq(schema.services.id, input.serviceId) });
    if (!service || !service.active) throw new SaleError("Service not available.");
    const override = input.staffId ? await tx.query.staffServices.findFirst({ where: and(eq(schema.staffServices.staffId, input.staffId), eq(schema.staffServices.serviceId, service.id)) }) : null;
    const price = input.priceCents ?? override?.priceCentsOverride ?? service.priceCents;
    const [agg] = await tx.select({ max: sql<number>`coalesce(max(${schema.saleLines.sortOrder}), -1)` }).from(schema.saleLines).where(and(eq(schema.saleLines.saleId, sale.id), eq(schema.saleLines.kind, "service")));
    await tx.insert(schema.saleLines).values({ businessId: input.businessId, saleId: sale.id, kind: "service", staffId: input.staffId, serviceId: service.id, name: service.name, quantity: 1, unitCents: price, amountCents: price, taxable: false, sortOrder: Number(agg?.max ?? -1) + 1 });
    await recompute(tx, sale.id, input.taxRateBps, await currentDiscount(tx, sale));
    await audit(tx, input.businessId, input.actorUserId, "sale.add_service", sale.id, { serviceId: service.id, price });
  });
}

/** Change a line's price, quantity or who gets credit for it (open tickets; not lines covered by a credit). */
export async function updateLine(input: { businessId: string; saleId: string; lineId: string; unitCents?: number | null; quantity?: number | null; staffId?: string | null; taxRateBps: number; actorUserId: string }) {
  await withTenant(input.businessId, async (tx) => {
    const sale = await tx.query.sales.findFirst({ where: eq(schema.sales.id, input.saleId) });
    if (!sale) throw new SaleError("Sale not found.");
    assertOpen(sale);
    const line = await tx.query.saleLines.findFirst({ where: and(eq(schema.saleLines.id, input.lineId), eq(schema.saleLines.saleId, sale.id)) });
    if (!line) throw new SaleError("Line not found.");
    if (line.kind === "tip") throw new SaleError("Change tips under Tips.");
    if (line.creditCents > 0) throw new SaleError("This line is covered by a credit. Remove it and add the service again to change it.");
    const unit = input.unitCents ?? line.unitCents;
    const qty = line.kind === "product" ? Math.max(1, Math.min(99, Math.round(input.quantity ?? line.quantity))) : line.quantity;
    if (unit < 0) throw new SaleError("Price can't be negative.");
    await tx
      .update(schema.saleLines)
      .set({ unitCents: unit, quantity: qty, amountCents: unit * qty, ...(input.staffId !== undefined ? { staffId: input.staffId } : {}) })
      .where(eq(schema.saleLines.id, line.id));
    await recompute(tx, sale.id, input.taxRateBps, await currentDiscount(tx, sale));
    await audit(tx, input.businessId, input.actorUserId, "sale.edit_line", sale.id, { lineId: line.id, from: { unit: line.unitCents, qty: line.quantity, staffId: line.staffId }, to: { unit, qty, staffId: input.staffId ?? line.staffId } });
  });
}

export async function removeLine(input: { businessId: string; saleId: string; lineId: string; taxRateBps: number }) {
  await withTenant(input.businessId, async (tx) => {
    const sale = await tx.query.sales.findFirst({ where: eq(schema.sales.id, input.saleId) });
    if (!sale) throw new SaleError("Sale not found.");
    assertOpen(sale);
    const line = await tx.query.saleLines.findFirst({ where: and(eq(schema.saleLines.id, input.lineId), eq(schema.saleLines.saleId, sale.id)) });
    if (!line) return;
    // A line covered by a package session or membership credit gives the session back.
    await restoreCreditForLine(tx, line);
    await tx.delete(schema.saleLines).where(eq(schema.saleLines.id, line.id));
    await recompute(tx, sale.id, input.taxRateBps, await currentDiscount(tx, sale));
  });
}

/**
 * The discount currently on a sale, re-derived from what was entered so it
 * follows line changes: a promo code (with its service scope), else the typed
 * percent/amount, else (rows from before the type was stored) the cents.
 */
async function currentDiscount(tx: TenantDb, sale: Sale): Promise<Discount | null> {
  if (sale.promoCodeId) {
    const promo = await tx.query.promoCodes.findFirst({ where: eq(schema.promoCodes.id, sale.promoCodeId) });
    if (promo) return { ...promoDiscount(promo), serviceIds: promo.serviceIds };
  }
  if ((sale.discountType === "percent" || sale.discountType === "amount") && sale.discountValue && sale.discountValue > 0) {
    return { type: sale.discountType, value: sale.discountValue };
  }
  return sale.discountCents > 0 ? { type: "amount", value: sale.discountCents } : null;
}

/** A typed discount replaces any promo code on the sale; "none" clears both. */
export async function setDiscount(input: { businessId: string; saleId: string; discount: Discount | null; note: string | null; taxRateBps: number }) {
  await withTenant(input.businessId, async (tx) => {
    const sale = await tx.query.sales.findFirst({ where: eq(schema.sales.id, input.saleId) });
    if (!sale) throw new SaleError("Sale not found.");
    assertOpen(sale);
    await tx.update(schema.sales).set({ discountType: input.discount?.type ?? null, discountValue: input.discount?.value ?? null, promoCodeId: null }).where(eq(schema.sales.id, sale.id));
    await recompute(tx, sale.id, input.taxRateBps, input.discount, input.note);
  });
}

export async function removePromoFromSale(input: { businessId: string; saleId: string; taxRateBps: number; actorUserId: string }) {
  await withTenant(input.businessId, async (tx) => {
    const sale = await tx.query.sales.findFirst({ where: eq(schema.sales.id, input.saleId) });
    if (!sale) throw new SaleError("Sale not found.");
    assertOpen(sale);
    if (!sale.promoCodeId) return;
    await tx.update(schema.sales).set({ promoCodeId: null, discountType: null, discountValue: null }).where(eq(schema.sales.id, sale.id));
    await recompute(tx, sale.id, input.taxRateBps, null, null);
    await audit(tx, input.businessId, input.actorUserId, "sale.promo_removed", sale.id);
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
    await recompute(tx, sale.id, input.taxRateBps, await currentDiscount(tx, sale));
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
  const t = await recompute(tx, saleId, taxRateBps, await currentDiscount(tx, sale));
  if (t.paidCents >= t.totalCents && sale.status === "open") {
    await tx.update(schema.sales).set({ status: "paid", closedAt: new Date() }).where(eq(schema.sales.id, saleId));
    if (sale.appointmentId) {
      await tx.update(schema.appointments).set({ status: "completed" }).where(eq(schema.appointments.id, sale.appointmentId));
      await tx
        .update(schema.appointmentItems)
        .set({ status: "completed" })
        .where(and(eq(schema.appointmentItems.appointmentId, sale.appointmentId), sql`${schema.appointmentItems.status} <> 'cancelled'`));
    }
    await fulfilOfferLines(tx, businessId, saleId);
    await decrementStockForSale(tx, businessId, saleId);
    if (sale.promoCodeId) await countPromoUse(tx, sale.promoCodeId);
    const business = await db.query.businesses.findFirst({ where: eq(schema.businesses.id, businessId) });
    if (business) {
      await awardPointsForSale(tx, business, { ...sale, ...t, status: "paid" });
      if (sale.appointmentId) {
        const apptId = sale.appointmentId;
        after(() => triggerAppointmentWorkflows(business, "appointment_completed", apptId).catch((e) => console.error("[workflows] completed trigger failed", apptId, (e as Error).message)));
      }
    }
    await audit(tx, businessId, actorUserId, "sale.paid", saleId, { total: t.totalCents });
  }
}

/** Re-evaluate a sale after an external payment row was added (gift card, credit). */
export async function settleIfPaid(businessId: string, saleId: string, actorUserId: string, taxRateBps: number) {
  await withTenant(businessId, (tx) => closeIfPaid(tx, saleId, taxRateBps, actorUserId, businessId));
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
    // The tip part of the payment shrinks in proportion, so tip reports and payroll follow the refund.
    const tipRefund = p.amountCents > 0 ? Math.min(p.tipCents, Math.round((p.tipCents * amount) / p.amountCents)) : 0;
    await tx
      .update(schema.payments)
      .set({ refundedCents: newRefunded, tipCents: p.tipCents - tipRefund, status: newRefunded >= p.amountCents ? "refunded" : "partially_refunded" })
      .where(eq(schema.payments.id, p.id));
    const sale = (await tx.query.sales.findFirst({ where: eq(schema.sales.id, p.saleId) }))!;
    // Refunding a points payment gives the points back.
    if (p.method === "loyalty" && sale.clientId) {
      const biz = await db.query.businesses.findFirst({ where: eq(schema.businesses.id, input.businessId), columns: { loyaltyPointValueCents: true } });
      const points = Math.round(amount / Math.max(1, biz?.loyaltyPointValueCents ?? 1));
      if (points > 0) await tx.insert(schema.loyaltyLedger).values({ businessId: input.businessId, clientId: sale.clientId, delta: points, reason: "adjust", saleId: sale.id, note: `Refund on sale #${sale.number}`, createdByUserId: input.actorUserId }).onConflictDoNothing();
    }
    // Refunding a gift card payment puts the money back on the card.
    if (p.method === "gift_card" && p.giftCardId) {
      await tx.update(schema.giftCards).set({ balanceCents: sql`${schema.giftCards.balanceCents} + ${amount}`, active: true }).where(eq(schema.giftCards.id, p.giftCardId));
    }
    const t = await recompute(tx, sale.id, input.taxRateBps, await currentDiscount(tx, sale));
    if (t.refundedCents >= t.paidCents && t.paidCents > 0) {
      await tx.update(schema.sales).set({ status: "refunded" }).where(eq(schema.sales.id, sale.id));
      await unwindPaidSale(tx, input.businessId, sale, input.actorUserId);
    }
    await audit(tx, input.businessId, input.actorUserId, "payment.refund", sale.id, { paymentId: p.id, amount });
  });
}

/**
 * Everything closeIfPaid did for a sale, undone once it is fully refunded:
 * stock back on the shelf, earned points taken back, the promo use released,
 * unused gift cards deactivated and untouched packages removed. Idempotent.
 * A partly used gift card or package is left alone (the owner decides).
 */
async function unwindPaidSale(tx: TenantDb, businessId: string, sale: Sale, actorUserId: string) {
  const sold = await tx.select().from(schema.stockMovements).where(and(eq(schema.stockMovements.saleId, sale.id), eq(schema.stockMovements.reason, "sale")));
  const returned = await tx.select({ id: schema.stockMovements.id }).from(schema.stockMovements).where(and(eq(schema.stockMovements.saleId, sale.id), eq(schema.stockMovements.reason, "refund")));
  if (sold.length && !returned.length) {
    for (const m of sold) {
      await tx.insert(schema.stockMovements).values({ businessId, productId: m.productId, delta: -m.delta, reason: "refund", saleId: sale.id, note: `Refund of sale #${sale.number}`, createdByUserId: actorUserId });
      await tx.update(schema.products).set({ stockQty: sql`${schema.products.stockQty} - ${m.delta}` }).where(eq(schema.products.id, m.productId));
    }
  }
  if (sale.clientId) {
    const earned = await tx.query.loyaltyLedger.findFirst({ where: and(eq(schema.loyaltyLedger.saleId, sale.id), eq(schema.loyaltyLedger.reason, "earn")) });
    if (earned && earned.delta > 0) {
      await tx.insert(schema.loyaltyLedger).values({ businessId, clientId: sale.clientId, delta: -earned.delta, reason: "refund", saleId: sale.id, note: `Refund of sale #${sale.number}`, createdByUserId: actorUserId }).onConflictDoNothing();
    }
  }
  if (sale.promoCodeId) {
    await tx.update(schema.promoCodes).set({ usesCount: sql`greatest(0, ${schema.promoCodes.usesCount} - 1)` }).where(eq(schema.promoCodes.id, sale.promoCodeId));
  }
  await tx.update(schema.giftCards).set({ active: false }).where(and(eq(schema.giftCards.saleId, sale.id), sql`${schema.giftCards.balanceCents} = ${schema.giftCards.initialCents}`));
  const packs = await tx
    .select({ id: schema.clientPackages.id })
    .from(schema.clientPackages)
    .innerJoin(schema.packages, eq(schema.packages.id, schema.clientPackages.packageId))
    .where(and(eq(schema.clientPackages.saleId, sale.id), sql`${schema.clientPackages.remaining} = ${schema.packages.sessions}`));
  if (packs.length) await tx.delete(schema.clientPackages).where(sql`${schema.clientPackages.id} in ${packs.map((x) => x.id)}`);
}

export async function voidSale(input: { businessId: string; saleId: string; actorUserId: string }) {
  await withTenant(input.businessId, async (tx) => {
    const sale = await tx.query.sales.findFirst({ where: eq(schema.sales.id, input.saleId) });
    if (!sale) throw new SaleError("Sale not found.");
    if (sale.paidCents > 0) throw new SaleError("Refund payments before voiding.");
    // Sessions and credits applied to this ticket go back to the client.
    const lines = await tx.select().from(schema.saleLines).where(and(eq(schema.saleLines.saleId, sale.id), gt(schema.saleLines.creditCents, 0)));
    for (const l of lines) await restoreCreditForLine(tx, l);
    await tx.update(schema.sales).set({ status: "void", closedAt: new Date() }).where(eq(schema.sales.id, sale.id));
    await audit(tx, input.businessId, input.actorUserId, "sale.void", sale.id);
  });
}

/** Sales summary for a local-date range: by day, by staff, by payment method, by location. `locationId` narrows to one site. */
export async function salesReport(businessId: string, from: Date, to: Date, locationId?: string | null) {
  return withTenant(businessId, async (tx) => {
    const closed = and(
      gte(schema.sales.closedAt, from),
      lt(schema.sales.closedAt, to),
      sql`${schema.sales.status} in ('paid','refunded')`,
      ...(locationId ? [eq(schema.sales.locationId, locationId)] : []),
    );
    const [sales, byStaff, byMethod] = await Promise.all([
      tx
        .select({
          id: schema.sales.id,
          number: schema.sales.number,
          closedAt: schema.sales.closedAt,
          locationId: schema.sales.locationId,
          locationName: schema.locations.name,
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
        .leftJoin(schema.locations, eq(schema.locations.id, schema.sales.locationId))
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
        .where(and(gte(schema.appointmentItems.startAt, from), lt(schema.appointmentItems.startAt, to), eq(schema.appointmentItems.sortOrder, 0), eq(schema.appointments.kind, "visit"), ...(locationId ? [eq(schema.appointments.locationId, locationId)] : [])))
        .groupBy(schema.appointments.status, schema.appointments.source),
    ]);
    // Per-location totals (always across all sites so the owner sees the split even when filtered).
    const allClosed = and(gte(schema.sales.closedAt, from), lt(schema.sales.closedAt, to), sql`${schema.sales.status} in ('paid','refunded')`);
    const [byLocation, crossGift, crossCredit] = await Promise.all([
      tx
        .select({
          locationId: schema.sales.locationId,
          locationName: schema.locations.name,
          count: sql<number>`count(*)`,
          sales: sql<number>`coalesce(sum(${schema.sales.totalCents} - ${schema.sales.tipCents}), 0)`,
          tips: sql<number>`coalesce(sum(${schema.sales.tipCents}), 0)`,
          tax: sql<number>`coalesce(sum(${schema.sales.taxCents}), 0)`,
          refunded: sql<number>`coalesce(sum(${schema.sales.refundedCents}), 0)`,
        })
        .from(schema.sales)
        .leftJoin(schema.locations, eq(schema.locations.id, schema.sales.locationId))
        .where(allClosed)
        .groupBy(schema.sales.locationId, schema.locations.name)
        .orderBy(schema.locations.name),
      // Gift cards sold at one site and spent at another: the selling site owes the redeeming site.
      tx
        .select({
          soldAt: schema.giftCards.locationId,
          redeemedAt: schema.sales.locationId,
          amount: sql<number>`coalesce(sum(${schema.payments.amountCents} - ${schema.payments.refundedCents}), 0)`,
          count: sql<number>`count(*)`,
        })
        .from(schema.payments)
        .innerJoin(schema.sales, eq(schema.sales.id, schema.payments.saleId))
        .innerJoin(schema.giftCards, eq(schema.giftCards.id, schema.payments.giftCardId))
        .where(and(closed, sql`${schema.payments.status} in ('succeeded','partially_refunded','refunded')`, sql`${schema.giftCards.locationId} is distinct from ${schema.sales.locationId}`, sql`${schema.giftCards.locationId} is not null`))
        .groupBy(schema.giftCards.locationId, schema.sales.locationId),
      // Package sessions / membership credits bought at one site and used at another.
      tx
        .select({
          kind: sql<"package" | "membership">`case when ${schema.saleLines.clientPackageId} is not null then 'package' else 'membership' end`,
          soldAt: sql<string | null>`coalesce(cp.location_id, cm.location_id)`,
          redeemedAt: schema.sales.locationId,
          amount: sql<number>`coalesce(sum(${schema.saleLines.creditCents}), 0)`,
          count: sql<number>`count(*)`,
        })
        .from(schema.saleLines)
        .innerJoin(schema.sales, eq(schema.sales.id, schema.saleLines.saleId))
        .leftJoin(sql`client_packages cp`, sql`cp.id = ${schema.saleLines.clientPackageId}`)
        .leftJoin(sql`client_memberships cm`, sql`cm.id = ${schema.saleLines.clientMembershipId}`)
        .where(and(closed, sql`${schema.saleLines.creditCents} > 0`, sql`coalesce(cp.location_id, cm.location_id) is not null`, sql`coalesce(cp.location_id, cm.location_id) is distinct from ${schema.sales.locationId}`))
        .groupBy(sql`1`, sql`2`, schema.sales.locationId),
    ]);
    const crossLocation = [
      ...crossGift.map((r) => ({ kind: "gift_card" as const, soldAt: r.soldAt, redeemedAt: r.redeemedAt, amount: Number(r.amount), count: Number(r.count) })),
      ...crossCredit.map((r) => ({ kind: r.kind, soldAt: r.soldAt, redeemedAt: r.redeemedAt, amount: Number(r.amount), count: Number(r.count) })),
    ];
    return { sales, byStaff, byMethod, byService, appts, byLocation, crossLocation };
  });
}

/** Redeem a promo code on an open ticket: becomes the sale discount. */
export async function applyPromoToSale(input: { businessId: string; saleId: string; code: string; taxRateBps: number; actorUserId: string }) {
  return withTenant(input.businessId, async (tx) => {
    const sale = await tx.query.sales.findFirst({ where: eq(schema.sales.id, input.saleId) });
    if (!sale) throw new SaleError("Sale not found.");
    assertOpen(sale);
    const lines = await tx.select().from(schema.saleLines).where(eq(schema.saleLines.saleId, sale.id));
    const promo = await validatePromo(tx, input.code, { serviceIds: lines.filter((l) => l.kind === "service").map((l) => l.serviceId), subtotalCents: sale.subtotalCents });
    const d = promoDiscount(promo);
    await tx.update(schema.sales).set({ promoCodeId: promo.id, discountType: d.type, discountValue: d.value }).where(eq(schema.sales.id, sale.id));
    await recompute(tx, sale.id, input.taxRateBps, { ...d, serviceIds: promo.serviceIds }, `Code ${promo.code}`);
    await audit(tx, input.businessId, input.actorUserId, "sale.promo", sale.id, { code: promo.code });
    return promo;
  });
}
