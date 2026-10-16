import { and, asc, desc, eq, gt, gte, lt, sql } from "drizzle-orm";
import { schema, withTenant, type TenantDb } from "@angelic/db";
import { CARD_FEE_METHODS, allocateProportionally, computeTotals, isMembershipInterval, splitTips, subtractMembershipPeriod, tipsPerPayment, type Discount } from "@angelic/core";
import { after } from "next/server";
import { db } from "@angelic/db";
import { stripe } from "@/lib/stripe";
import { platformFeeBpsFor } from "./price-book";
import { ensureStripeCustomer } from "./stripe-connect";
import { fulfilOfferLines, restoreCreditForLine } from "./offers";
import { changeStoreCredit, creditedAgainstPayment } from "./store-credit";
import { awardPointsForSale } from "./loyalty";
import { triggerAppointmentWorkflows } from "./workflows";
import { decrementStockForSale } from "./inventory";
import { productLabel } from "@/lib/inventory";
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
  const [flag] = await tx.select({ exempt: schema.sales.taxExempt }).from(schema.sales).where(eq(schema.sales.id, saleId));
  if (flag?.exempt) return 0;
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

/**
 * Member pricing: when the ticket's client holds an active membership with "% off other services" that is valid at the ticket's location,
 * each service line not paid with a credit gets that discount (the best one, if several). Lines already priced for a member are left
 * alone; if the client changes or loses the membership, the discount comes off again. Call before recompute.
 */
async function applyMemberPricing(tx: TenantDb, saleId: string) {
  const [sale] = await tx.select().from(schema.sales).where(eq(schema.sales.id, saleId));
  if (!sale || sale.status !== "open") return;
  let bps = 0;
  if (sale.clientId) {
    const plans = await tx
      .select({ bps: schema.membershipPlans.discountBps, valid: schema.membershipPlans.validLocationIds })
      .from(schema.clientMemberships)
      .innerJoin(schema.membershipPlans, eq(schema.membershipPlans.id, schema.clientMemberships.planId))
      .where(and(eq(schema.clientMemberships.clientId, sale.clientId), eq(schema.clientMemberships.status, "active"), gt(schema.clientMemberships.currentPeriodEnd, new Date()), gt(schema.membershipPlans.discountBps, 0)));
    bps = Math.max(0, ...plans.filter((p) => !p.valid?.length || !sale.locationId || p.valid.includes(sale.locationId)).map((p) => Math.min(10_000, p.bps)));
  }
  const lines = await tx.select().from(schema.saleLines).where(and(eq(schema.saleLines.saleId, saleId), eq(schema.saleLines.kind, "service"), eq(schema.saleLines.creditCents, 0)));
  for (const l of lines) {
    if (l.memberDiscountBps === bps) continue;
    const list = l.preMemberUnitCents ?? l.unitCents;
    const unit = bps ? Math.round((list * (10_000 - bps)) / 10_000) : list;
    await tx
      .update(schema.saleLines)
      .set({ unitCents: unit, amountCents: unit * l.quantity, memberDiscountBps: bps, preMemberUnitCents: bps ? list : null })
      .where(eq(schema.saleLines.id, l.id));
  }
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
        stripeAccountId: appt.depositStripeAccountId,
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
    await applyMemberPricing(tx, sale!.id);
    await recompute(tx, sale!.id, input.taxRateBps, discount);
    await audit(tx, input.businessId, input.actorUserId, "sale.open", sale!.id, { appointmentId: appt.id });
    return sale!.id;
  });
}

/**
 * A ticket that holds only a fee for an appointment (no-show or late cancellation), ready to charge. The visit's services are not on it,
 * and a paid online deposit is left on the appointment, where the cancel/no-show flow decides to keep or refund it. The fee amount passed
 * in is what is still owed after any deposit the policy counts toward it.
 *
 * An open visit ticket for the appointment is reused (its lines removed, package sessions and credits given back, and a deposit it had
 * taken as a payment put back on the appointment); a ticket with any other payment can't be turned into a fee.
 */
export async function openFeeSaleForAppointment(input: { businessId: string; appointmentId: string; name: string; feeCents: number; actorUserId: string; taxRateBps: number; currency: string; auditAction: string; auditDiff?: unknown }) {
  if (!Number.isInteger(input.feeCents) || input.feeCents <= 0) throw new SaleError("There is no fee to charge.");
  return withTenant(input.businessId, async (tx) => {
    const appt = await tx.query.appointments.findFirst({ where: eq(schema.appointments.id, input.appointmentId) });
    if (!appt) throw new SaleError("Appointment not found.");
    // Lock the live ticket (if any) so two clicks can't both rebuild it.
    const [existing] = await tx.select().from(schema.sales).where(and(eq(schema.sales.appointmentId, appt.id), sql`${schema.sales.status} <> 'void'`)).for("update");
    let saleId: string;
    if (existing) {
      if (existing.status !== "open") throw new SaleError("This appointment already has a paid ticket. Refund or void it first.");
      const pays = await tx.select().from(schema.payments).where(and(eq(schema.payments.saleId, existing.id), sql`${schema.payments.status} in ('pending','succeeded','partially_refunded','refunded')`));
      const isDeposit = (p: (typeof pays)[number]) => p.note === "Deposit paid online" && !!appt.depositPaymentIntentId && p.stripePaymentIntentId === appt.depositPaymentIntentId;
      if (pays.some((p) => !isDeposit(p))) throw new SaleError("This appointment's ticket already has a payment. Finish or refund it first.");
      const deposit = pays.find(isDeposit);
      if (deposit) {
        await tx.delete(schema.payments).where(eq(schema.payments.id, deposit.id));
        await tx.update(schema.appointments).set({ depositStatus: "paid" }).where(eq(schema.appointments.id, appt.id));
      }
      const credited = await tx.select().from(schema.saleLines).where(and(eq(schema.saleLines.saleId, existing.id), gt(schema.saleLines.creditCents, 0)));
      for (const l of credited) await restoreCreditForLine(tx, l);
      await tx.delete(schema.saleLines).where(eq(schema.saleLines.saleId, existing.id));
      await tx.update(schema.sales).set({ promoCodeId: null, discountNote: null }).where(eq(schema.sales.id, existing.id));
      saleId = existing.id;
    } else {
      const rows = await tx.execute<{ n: number }>(sql`select next_sale_number(${input.businessId}) as n`);
      const location = await locationOrDefault(tx, appt.locationId);
      const [sale] = await tx
        .insert(schema.sales)
        .values({ businessId: input.businessId, number: Number(rows[0]?.n ?? 1001), appointmentId: appt.id, locationId: location?.id ?? null, clientId: appt.clientId, currency: input.currency, createdByUserId: input.actorUserId })
        .returning();
      saleId = sale!.id;
    }
    await tx.insert(schema.saleLines).values({ businessId: input.businessId, saleId, kind: "fee", name: input.name, quantity: 1, unitCents: input.feeCents, amountCents: input.feeCents, taxable: false });
    await recompute(tx, saleId, input.taxRateBps, null, null);
    await tx.insert(schema.auditLog).values({ businessId: input.businessId, actorUserId: input.actorUserId, action: input.auditAction, entity: "appointment", entityId: appt.id, diff: input.auditDiff === undefined ? null : JSON.stringify(input.auditDiff) });
    return saleId;
  });
}

/** A ticket whose only charges are fees (no-show, late cancellation): paying it is not a visit. */
async function isFeeOnly(tx: TenantDb, saleId: string): Promise<boolean> {
  const kinds = await tx.selectDistinct({ kind: schema.saleLines.kind }).from(schema.saleLines).where(and(eq(schema.saleLines.saleId, saleId), sql`${schema.saleLines.kind} <> 'tip'`));
  return kinds.length > 0 && kinds.every((k) => k.kind === "fee");
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
    // The new client's member pricing (or none) replaces the old one's.
    await applyMemberPricing(tx, sale.id);
    const biz = await tx.query.businesses.findFirst({ where: eq(schema.businesses.id, input.businessId), columns: { taxRateBps: true } });
    await recompute(tx, sale.id, biz?.taxRateBps ?? 0, await currentDiscount(tx, { ...sale, clientId: input.clientId }));
    await audit(tx, input.businessId, input.actorUserId, "sale.client", sale.id, { clientId: input.clientId });
  });
}

export type SalesListFilter = {
  status?: "open" | "closed" | "all";
  q?: string;
  from?: Date;
  to?: Date;
  page?: number;
  pageSize?: number;
  /** For a role that sees only its own calendar: only tickets this person is credited on or rang up. */
  own?: { staffId?: string | null; userId: string };
};

/** A ticket this person may open when they see only their own work: credited on a line, or they rang it up. */
function ownSaleCondition(own: { staffId?: string | null; userId: string }) {
  return own.staffId
    ? sql`(${schema.sales.createdByUserId} = ${own.userId} or exists (select 1 from sale_lines sl where sl.sale_id = ${schema.sales.id} and sl.staff_id = ${own.staffId}))`
    : sql`${schema.sales.createdByUserId} = ${own.userId}`;
}

export async function isOwnSale(businessId: string, saleId: string, own: { staffId?: string | null; userId: string }): Promise<boolean> {
  const [row] = await withTenant(businessId, (tx) => tx.select({ id: schema.sales.id }).from(schema.sales).where(and(eq(schema.sales.id, saleId), ownSaleCondition(own))).limit(1));
  return Boolean(row);
}

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
    if (f.own) conds.push(ownSaleCondition(f.own));
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
        .select({ id: schema.products.id, name: schema.products.name, variantLabel: schema.products.variantLabel, barcode: schema.products.barcode, trackStock: schema.products.trackStock, priceCents: schema.products.priceCents, taxable: schema.products.taxable, imageUrl: schema.products.imageUrl, category: schema.productCategories.name })
        .from(schema.products)
        .leftJoin(schema.productCategories, eq(schema.productCategories.id, schema.products.categoryId))
        .where(and(eq(schema.products.active, true), eq(schema.products.kind, "retail")))
        .orderBy(asc(schema.productCategories.sortOrder), asc(schema.productCategories.name), asc(schema.products.name), asc(schema.products.variantLabel)),
    ]);
    const refunds = pays.length
      ? await tx.select().from(schema.refunds).where(sql`${schema.refunds.paymentId} in ${pays.map((p) => p.id)}`)
      : [];
    const credits = await tx.select().from(schema.storeCreditLedger).where(eq(schema.storeCreditLedger.saleId, saleId)).orderBy(asc(schema.storeCreditLedger.createdAt));
    return { sale, lines, payments: pays, refunds, credits, client: client ?? null, staff: staffRows, products };
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
    if (!product || !product.active || product.kind !== "retail") throw new SaleError("Product not available.");
    // A product with no price (e.g. it used to be back-bar) isn't sold for nothing by accident.
    if (product.priceCents <= 0) throw new SaleError(`${product.name} has no price yet. Set one under Products first.`);
    const qty = Math.max(1, Math.min(99, Math.round(input.quantity)));
    await tx.insert(schema.saleLines).values({
      businessId: input.businessId,
      saleId: sale.id,
      kind: "product",
      staffId: input.staffId,
      productId: product.id,
      name: productLabel(product),
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
    // A price typed at the desk is the price; otherwise a member's discount applies.
    if (input.priceCents == null) await applyMemberPricing(tx, sale.id);
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
      .set({ unitCents: unit, quantity: qty, amountCents: unit * qty, ...(input.unitCents != null && input.unitCents !== line.unitCents ? { memberDiscountBps: 0, preMemberUnitCents: null } : {}), ...(input.staffId !== undefined ? { staffId: input.staffId } : {}) })
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
export async function setTips(input: { businessId: string; saleId: string; tips: { staffId: string | null; amountCents: number; /** How it is handed over; omitted = same as the payment. */ method?: "cash" | "card" | null }[]; taxRateBps: number }) {
  await withTenant(input.businessId, async (tx) => {
    const sale = await tx.query.sales.findFirst({ where: eq(schema.sales.id, input.saleId) });
    if (!sale) throw new SaleError("Sale not found.");
    assertOpen(sale);
    await tx.delete(schema.saleLines).where(and(eq(schema.saleLines.saleId, sale.id), eq(schema.saleLines.kind, "tip")));
    // An unassigned tip follows service revenue; on a ticket with only products it follows whoever is credited for them.
    const creditable = await tx
      .select()
      .from(schema.saleLines)
      .where(and(eq(schema.saleLines.saleId, sale.id), sql`${schema.saleLines.kind} in ('service','product')`));
    const serviceLines = creditable.some((l) => l.kind === "service") ? creditable.filter((l) => l.kind === "service") : creditable;
    // One tip line per person and way of tipping, so a cash tip and a card tip for the same stylist stay apart.
    const byStaff = new Map<string, { staffId: string; method: "cash" | "card" | null; amountCents: number }>();
    const add = (staffId: string, method: "cash" | "card" | null, cents: number) => {
      const key = `${staffId}|${method ?? ""}`;
      const cur = byStaff.get(key);
      byStaff.set(key, { staffId, method, amountCents: (cur?.amountCents ?? 0) + cents });
    };
    for (const t of input.tips) {
      if (t.amountCents <= 0) continue;
      const method = t.method === "cash" || t.method === "card" ? t.method : null;
      if (t.staffId) add(t.staffId, method, t.amountCents);
      else {
        const weights = [...new Set(serviceLines.map((l) => l.staffId).filter((x): x is string => !!x))].map((key) => ({
          key,
          weight: serviceLines.filter((l) => l.staffId === key).reduce((s, l) => s + l.amountCents, 0),
        }));
        // Nobody is credited on the ticket to share it between: refuse rather than quietly drop the tip.
        if (!weights.length) throw new SaleError("Choose who the tip is for: nobody is credited on this sale yet.");
        const split = allocateProportionally(t.amountCents, weights);
        for (const [k, v] of Object.entries(split)) add(k, method, v);
      }
    }
    if (byStaff.size) {
      await tx.insert(schema.saleLines).values(
        [...byStaff.values()].map(({ staffId, method, amountCents }) => ({
          businessId: input.businessId,
          saleId: sale.id,
          kind: "tip" as const,
          tipMethod: method,
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

/** A private note on the ticket (open or closed): never printed on the receipt. */
export async function setSaleNotes(input: { businessId: string; saleId: string; notes: string | null; actorUserId: string }) {
  await withTenant(input.businessId, async (tx) => {
    const sale = await tx.query.sales.findFirst({ where: eq(schema.sales.id, input.saleId) });
    if (!sale) throw new SaleError("Sale not found.");
    await tx.update(schema.sales).set({ notes: input.notes?.trim() || null }).where(eq(schema.sales.id, sale.id));
    await audit(tx, input.businessId, input.actorUserId, "sale.note", sale.id);
  });
}

/** Charge no sales tax on this ticket (an exempt client, a resale). Recomputes the totals. */
export async function setTaxExempt(input: { businessId: string; saleId: string; exempt: boolean; actorUserId: string; taxRateBps: number }) {
  await withTenant(input.businessId, async (tx) => {
    const sale = await tx.query.sales.findFirst({ where: eq(schema.sales.id, input.saleId) });
    if (!sale) throw new SaleError("Sale not found.");
    assertOpen(sale);
    await tx.update(schema.sales).set({ taxExempt: input.exempt }).where(eq(schema.sales.id, sale.id));
    await recompute(tx, sale.id, input.taxRateBps, await currentDiscount(tx, sale));
    await audit(tx, input.businessId, input.actorUserId, input.exempt ? "sale.tax_exempt" : "sale.taxable", sale.id);
  });
}

/** Close a ticket whose total is nothing (a comp, a visit fully covered by a package or a 100% discount) without a payment row. */
export async function completeNoCharge(input: { businessId: string; saleId: string; actorUserId: string; taxRateBps: number }) {
  await withTenant(input.businessId, async (tx) => {
    const sale = await tx.query.sales.findFirst({ where: eq(schema.sales.id, input.saleId) });
    if (!sale) throw new SaleError("Sale not found.");
    assertOpen(sale);
    const t = await recompute(tx, sale.id, input.taxRateBps, await currentDiscount(tx, sale));
    if (t.totalCents > t.paidCents) throw new SaleError("There is still an amount due.");
    const [n] = await tx.select({ n: sql<number>`count(*)::int` }).from(schema.saleLines).where(and(eq(schema.saleLines.saleId, sale.id), sql`${schema.saleLines.kind} <> 'tip'`));
    if (!n?.n) throw new SaleError("Add something to the ticket first.");
    await closeIfPaid(tx, sale.id, input.taxRateBps, input.actorUserId, input.businessId);
  });
}

/**
 * A tip that comes after the sale was paid (the client decides later, or leaves cash on the counter). The sale stays paid: it gets a tip line and a matching
 * payment, so total, paid and refunds stay consistent and nothing that ran when the sale closed (points, stock, gift cards) runs again.
 * `card` charges a card the client has on file; `cash` records the cash.
 */
export async function addTipAfterPayment(input: {
  businessId: string;
  saleId: string;
  staffId: string;
  amountCents: number;
  method: "cash" | "card";
  /** For `card`: the saved card to charge, and the Stripe account that takes it. */
  paymentMethodId?: string;
  accountId?: string | null;
  actorUserId: string;
  taxRateBps: number;
}) {
  if (!Number.isInteger(input.amountCents) || input.amountCents <= 0) throw new SaleError("Enter a tip amount.");
  // Checks, and for a card the pending payment row, committed before Stripe is called (see chargeCardOnFile).
  const prep = await withTenant(input.businessId, async (tx) => {
    const [sale] = await tx.select().from(schema.sales).where(eq(schema.sales.id, input.saleId)).for("update");
    if (!sale) throw new SaleError("Sale not found.");
    if (sale.status !== "paid") throw new SaleError("A tip can be added to a sale once it is paid in full.");
    const person = await tx.query.staff.findFirst({ where: eq(schema.staff.id, input.staffId), columns: { id: true } });
    if (!person) throw new SaleError("Choose who the tip is for.");
    if (input.method === "cash") {
      const [row] = await tx.insert(schema.payments).values({ businessId: input.businessId, saleId: sale.id, method: "cash", status: "pending", amountCents: input.amountCents, tipCents: input.amountCents, note: LATE_TIP_NOTE, createdByUserId: input.actorUserId }).returning({ id: schema.payments.id });
      await settleLateTip(tx, input.businessId, row!.id, input.staffId, input.method, input.taxRateBps, input.actorUserId, {});
      return null;
    }
    if (!input.paymentMethodId || !input.accountId) throw new SaleError("Choose a saved card, or record the tip as cash.");
    if (!sale.clientId) throw new SaleError("Attach a client to use a saved card.");
    if (input.amountCents < 50) throw new SaleError("A card tip must be at least $0.50.");
    const [inflight] = await tx.select({ n: sql<number>`count(*)::int` }).from(schema.payments).where(and(eq(schema.payments.saleId, sale.id), eq(schema.payments.status, "pending"), eq(schema.payments.note, LATE_TIP_NOTE), sql`${schema.payments.createdAt} > now() - interval '10 minutes'`));
    if (inflight?.n) throw new SaleError("A card tip for this sale is already being charged. Wait a moment and reload.");
    const client = await tx.query.clients.findFirst({ where: eq(schema.clients.id, sale.clientId) });
    if (!client) throw new SaleError("Client not found.");
    const fee = Math.round((input.amountCents * (await platformFeeBpsFor(input.businessId, tx))) / 10_000);
    const [row] = await tx.insert(schema.payments).values({ businessId: input.businessId, saleId: sale.id, method: "card_on_file", status: "pending", amountCents: input.amountCents, tipCents: input.amountCents, note: LATE_TIP_NOTE, stripeAccountId: input.accountId, createdByUserId: input.actorUserId }).returning({ id: schema.payments.id });
    return { sale, client, fee, paymentId: row!.id };
  });
  if (!prep) return;
  const { sale, client, fee, paymentId } = prep;
  const accountId = input.accountId!;
  let pi;
  try {
    const customerId = await ensureStripeCustomer({ accountId, businessId: input.businessId, client });
    pi = await stripe().paymentIntents.create(
      { amount: input.amountCents, currency: sale.currency, customer: customerId, payment_method: input.paymentMethodId, off_session: true, confirm: true, description: `Tip · Sale #${sale.number}`, metadata: { businessId: input.businessId, saleId: sale.id, paymentId, tipFor: input.staffId }, expand: ["latest_charge"], ...(fee > 0 ? { application_fee_amount: fee } : {}) },
      { stripeAccount: accountId, idempotencyKey: `tip_${paymentId}` },
    );
  } catch (e) {
    await failPendingPayment(input.businessId, paymentId, (e as Error).message);
    throw new SaleError(`Card declined: ${(e as Error).message}`);
  }
  if (pi.status !== "succeeded") {
    await failPendingPayment(input.businessId, paymentId, `Needs the client to confirm (${pi.status})`);
    await stripe().paymentIntents.cancel(pi.id, {}, { stripeAccount: accountId }).catch(() => undefined);
    throw new SaleError("The card needs the client to confirm it, so the tip was not charged.");
  }
  const charge = typeof pi.latest_charge === "object" && pi.latest_charge ? pi.latest_charge : null;
  await withTenant(input.businessId, (tx) =>
    settleLateTip(tx, input.businessId, paymentId, input.staffId, "card", input.taxRateBps, input.actorUserId, {
      stripePaymentIntentId: pi.id,
      stripeChargeId: charge?.id ?? (typeof pi.latest_charge === "string" ? pi.latest_charge : null),
      cardBrand: charge?.payment_method_details?.card?.brand ?? null,
      cardLast4: charge?.payment_method_details?.card?.last4 ?? null,
    }),
  );
}

const LATE_TIP_NOTE = "Tip added after payment";

/**
 * Turn a pending late-tip payment into a paid one and add its tip line. Runs once per payment, whoever gets there first (the request that
 * charged the card, or the webhook after a crash): only the call that flips the row from pending adds the line.
 */
async function settleLateTip(tx: TenantDb, businessId: string, paymentId: string, staffId: string, method: "cash" | "card", taxRateBps: number, actorUserId: string, card: Partial<typeof schema.payments.$inferInsert>) {
  const [p] = await tx.update(schema.payments).set({ status: "succeeded", ...card }).where(and(eq(schema.payments.id, paymentId), eq(schema.payments.status, "pending"))).returning();
  if (!p) return;
  await tx.insert(schema.saleLines).values({ businessId, saleId: p.saleId, kind: "tip", tipMethod: method, staffId, name: "Tip", quantity: 1, unitCents: p.amountCents, amountCents: p.amountCents, taxable: false, sortOrder: 900 });
  const sale = (await tx.query.sales.findFirst({ where: eq(schema.sales.id, p.saleId) }))!;
  await recompute(tx, sale.id, taxRateBps, await currentDiscount(tx, sale));
  await audit(tx, businessId, actorUserId, "sale.tip_after_payment", sale.id, { staffId, cents: p.amountCents, method });
}

/** A card attempt that Stripe refused: its pending row becomes "failed" (own transaction, after the Stripe call). */
async function failPendingPayment(businessId: string, paymentId: string, reason: string) {
  await withTenant(businessId, (tx) => tx.update(schema.payments).set({ status: "failed", note: reason.slice(0, 500) }).where(and(eq(schema.payments.id, paymentId), eq(schema.payments.status, "pending"))));
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
    // A no-show or late-cancel fee closes the fee, nothing else: the visit didn't happen, so no "completed", no review request or
    // rebooking nudge, no loyalty points or referral reward.
    if (await isFeeOnly(tx, saleId)) {
      await audit(tx, businessId, actorUserId, "sale.paid", saleId, { total: t.totalCents, fee: true });
      return;
    }
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
    const business = await tx.query.businesses.findFirst({ where: eq(schema.businesses.id, businessId) });
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

/** One ticket line that can be refunded: what the client paid for it (after its share of the discount, plus its tax) and what is left. */
export interface RefundableLine {
  id: string;
  kind: Line["kind"];
  name: string;
  staffId: string | null;
  quantity: number;
  paidCents: number;
  taxCents: number;
  refundedCents: number;
  remainingCents: number;
  /** For a gift card: what is still on the card (money already spent can't be refunded). */
  giftCardBalanceCents?: number;
}

export type RefundItemInput = { saleLineId: string; amountCents: number; quantity?: number };

async function refundableLinesIn(tx: TenantDb, sale: Sale): Promise<RefundableLine[]> {
  const lines = await tx.select().from(schema.saleLines).where(eq(schema.saleLines.saleId, sale.id)).orderBy(asc(schema.saleLines.sortOrder));
  const done = await tx.select({ lineId: schema.refundItems.saleLineId, cents: sql<number>`sum(${schema.refundItems.amountCents})::int` }).from(schema.refundItems).where(eq(schema.refundItems.saleId, sale.id)).groupBy(schema.refundItems.saleLineId);
  const refunded = new Map(done.map((d) => [d.lineId, Number(d.cents)]));
  const goods = lines.filter((l) => l.kind !== "tip");
  const goodsTotal = goods.reduce((n, l) => n + l.amountCents, 0);
  const taxableTotal = goods.filter((l) => l.taxable).reduce((n, l) => n + l.amountCents, 0);
  const cards = await tx.select().from(schema.giftCards).where(eq(schema.giftCards.saleId, sale.id));
  const out: RefundableLine[] = [];
  for (const l of lines) {
    const disc = l.kind === "tip" || goodsTotal <= 0 ? 0 : Math.round((sale.discountCents * l.amountCents) / goodsTotal);
    const tax = l.kind !== "tip" && l.taxable && taxableTotal > 0 ? Math.round((sale.taxCents * l.amountCents) / taxableTotal) : 0;
    const paid = l.amountCents - disc + tax;
    if (paid <= 0) continue; // covered by a package or membership credit: no money to give back
    const already = refunded.get(l.id) ?? 0;
    let remaining = Math.max(0, paid - already);
    let giftCardBalanceCents: number | undefined;
    if (l.kind === "gift_card") {
      const card = cards.filter((c) => c.initialCents === l.amountCents && c.active).sort((a, b) => b.balanceCents - a.balanceCents)[0];
      giftCardBalanceCents = card?.balanceCents ?? 0;
      remaining = Math.min(remaining, giftCardBalanceCents);
    }
    out.push({ id: l.id, kind: l.kind, name: l.name, staffId: l.staffId, quantity: l.quantity, paidCents: paid, taxCents: tax, refundedCents: already, remainingCents: remaining, giftCardBalanceCents });
  }
  return out;
}

/** The ticket's lines with what can still be refunded on each, for the refund form. */
export async function refundableLines(businessId: string, saleId: string): Promise<RefundableLine[]> {
  return withTenant(businessId, async (tx) => {
    const sale = await tx.query.sales.findFirst({ where: eq(schema.sales.id, saleId) });
    return sale ? refundableLinesIn(tx, sale) : [];
  });
}

type PlannedItem = { line: RefundableLine; amountCents: number; taxCents: number; quantity: number };

/** Check the chosen lines and amounts before any money moves. The refund is their sum. */
async function planRefundItems(tx: TenantDb, sale: Sale, items: RefundItemInput[]): Promise<PlannedItem[]> {
  const avail = new Map((await refundableLinesIn(tx, sale)).map((l) => [l.id, l]));
  const seen = new Set<string>();
  const planned: PlannedItem[] = [];
  for (const it of items) {
    if (!Number.isInteger(it.amountCents) || it.amountCents <= 0) continue;
    if (seen.has(it.saleLineId)) throw new SaleError("Each item can be listed once.");
    seen.add(it.saleLineId);
    const line = avail.get(it.saleLineId);
    if (!line) throw new SaleError("That item isn't on this ticket, or has nothing left to refund.");
    if (line.remainingCents <= 0) throw new SaleError(line.kind === "gift_card" ? `${line.name}: nothing is left on the card to refund.` : `${line.name} has already been refunded.`);
    if (it.amountCents > line.remainingCents) {
      throw new SaleError(line.kind === "gift_card" && line.giftCardBalanceCents !== undefined && line.giftCardBalanceCents < line.paidCents - line.refundedCents
        ? `Only ${(line.remainingCents / 100).toFixed(2)} is left on the gift card; what was spent can't be refunded.`
        : `${line.name}: only ${(line.remainingCents / 100).toFixed(2)} is left to refund.`);
    }
    const quantity = Math.max(1, Math.min(line.quantity, it.quantity ?? line.quantity));
    planned.push({ line, amountCents: it.amountCents, taxCents: line.paidCents > 0 ? Math.round((line.taxCents * it.amountCents) / line.paidCents) : 0, quantity });
  }
  if (!planned.length) throw new SaleError("Choose what is being refunded.");
  return planned;
}

/**
 * Save which lines a refund was for, and undo what the refunded items gave the client: a refunded gift card loses that much balance
 * (and is switched off at zero); a package refunded in full loses its unused sessions (removed if none were used).
 */
async function recordRefundItems(tx: TenantDb, businessId: string, sale: Sale, planned: PlannedItem[], link: { refundId?: string; creditLedgerId?: string }, actorUserId: string): Promise<string[]> {
  const stopBilling: string[] = [];
  await tx.insert(schema.refundItems).values(
    planned.map((p) => ({ businessId, saleId: sale.id, saleLineId: p.line.id, refundId: link.refundId ?? null, creditLedgerId: link.creditLedgerId ?? null, amountCents: p.amountCents, taxCents: p.taxCents, quantity: p.quantity, createdByUserId: actorUserId })),
  );
  for (const p of planned) {
    const line = (await tx.query.saleLines.findFirst({ where: eq(schema.saleLines.id, p.line.id) }))!;
    if (line.kind === "gift_card") {
      const [card] = await tx.select().from(schema.giftCards).where(and(eq(schema.giftCards.saleId, sale.id), eq(schema.giftCards.initialCents, line.amountCents), eq(schema.giftCards.active, true))).orderBy(desc(schema.giftCards.balanceCents)).limit(1).for("update");
      if (card) {
        const left = Math.max(0, card.balanceCents - p.amountCents);
        await tx.update(schema.giftCards).set({ balanceCents: left, active: left > 0 }).where(eq(schema.giftCards.id, card.id));
      }
    } else if (line.kind === "package" && line.productId && p.amountCents >= p.line.remainingCents) {
      const [pack] = await tx
        .select({ id: schema.clientPackages.id, remaining: schema.clientPackages.remaining, sessions: schema.packages.sessions })
        .from(schema.clientPackages)
        .innerJoin(schema.packages, eq(schema.packages.id, schema.clientPackages.packageId))
        .where(and(eq(schema.clientPackages.saleId, sale.id), eq(schema.clientPackages.packageId, line.productId), gt(schema.clientPackages.remaining, 0)))
        .limit(1);
      if (pack) {
        if (pack.remaining === pack.sessions) await tx.delete(schema.clientPackages).where(eq(schema.clientPackages.id, pack.id));
        else await tx.update(schema.clientPackages).set({ remaining: 0 }).where(eq(schema.clientPackages.id, pack.id));
      }
    } else if (line.kind === "membership" && p.amountCents >= p.line.remainingCents) {
      const stop = await undoMembershipLine(tx, businessId, sale, line, actorUserId);
      if (stop) stopBilling.push(stop);
    }
  }
  return stopBilling;
}

/**
 * A membership line refunded in full. The ticket that started the membership cancels it (credits gone, auto-renew stopped: the returned
 * id is for the caller to stop its Stripe billing after the commit); a renewal ticket takes back the period and the credits it added.
 */
async function undoMembershipLine(tx: TenantDb, businessId: string, sale: Sale, line: typeof schema.saleLines.$inferSelect, actorUserId: string): Promise<string | null> {
  if (!line.productId || !sale.clientId) return null;
  const plan = await tx.query.membershipPlans.findFirst({ where: eq(schema.membershipPlans.id, line.productId) });
  const [m] = await tx
    .select()
    .from(schema.clientMemberships)
    .where(and(eq(schema.clientMemberships.clientId, sale.clientId), eq(schema.clientMemberships.planId, line.productId), sql`${schema.clientMemberships.status} in ('active','paused')`))
    .orderBy(desc(schema.clientMemberships.startedAt))
    .limit(1)
    .for("update");
  if (!m || !plan) return null;
  // Started by this ticket (or, before tickets were recorded, never renewed): cancel it.
  if (m.saleId === sale.id || (!m.saleId && m.cyclesBilled <= 1)) {
    await tx.update(schema.clientMemberships).set({ status: "cancelled", cancelledAt: new Date(), creditsRemaining: 0, autoRenew: false }).where(eq(schema.clientMemberships.id, m.id));
    await tx.insert(schema.auditLog).values({ businessId, actorUserId, action: "membership.cancel_refund", entity: "client_membership", entityId: m.id, diff: JSON.stringify({ saleId: sale.id }) });
    return m.stripeSubscriptionId ? m.id : null;
  }
  // A renewal: put back what it was before this ticket (recorded at renewal); older renewals take one period and its credits off.
  const renew = await tx.query.auditLog.findFirst({ where: and(eq(schema.auditLog.action, "membership.renew"), eq(schema.auditLog.entityId, m.id), sql`${schema.auditLog.diff}::jsonb->>'saleId' = ${sale.id}`) });
  const before = renew?.diff ? (JSON.parse(renew.diff) as { before: { currentPeriodEnd: string; creditsRemaining: number; cyclesBilled: number } }).before : null;
  const interval = isMembershipInterval(plan.interval) ? plan.interval : "month";
  await tx
    .update(schema.clientMemberships)
    .set(
      before
        ? { currentPeriodEnd: new Date(before.currentPeriodEnd), creditsRemaining: Math.min(before.creditsRemaining, m.creditsRemaining), cyclesBilled: before.cyclesBilled }
        : { currentPeriodEnd: subtractMembershipPeriod(m.currentPeriodEnd, interval, plan.intervalCount), creditsRemaining: Math.max(0, m.creditsRemaining - plan.includedSessions), cyclesBilled: Math.max(1, m.cyclesBilled - 1) },
    )
    .where(eq(schema.clientMemberships.id, m.id));
  await tx.insert(schema.auditLog).values({ businessId, actorUserId, action: "membership.renewal_refunded", entity: "client_membership", entityId: m.id, diff: JSON.stringify({ saleId: sale.id }) });
  return null;
}

/** Stop the Stripe subscription of memberships cancelled by a refund (after the refund committed). A failure is logged, not thrown. */
async function stopMembershipBilling(businessId: string, membershipIds: string[], actorUserId: string) {
  if (!membershipIds.length) return;
  const { disableAutoRenew } = await import("./membership-billing");
  const business = await db.query.businesses.findFirst({ where: eq(schema.businesses.id, businessId) });
  if (!business) return;
  for (const id of membershipIds) {
    await disableAutoRenew(business, id, actorUserId, true).catch((e) => console.error("[refund] could not stop membership billing", id, (e as Error).message));
  }
}

/**
 * Refund as store credit: the money stays in the till and the client gets a balance to spend later.
 * The payment is left as is (it really was collected); the ledger row points at it so a later card
 * refund cannot double up.
 */
export async function refundToStoreCredit(input: { businessId: string; paymentId: string; amountCents: number; reason: string | null; reasonId?: string | null; actorUserId: string; /** The lines being refunded; the amount is then their sum. */ items?: RefundItemInput[] }) {
  const stopBilling: string[] = [];
  await withTenant(input.businessId, async (tx) => {
    const [p] = await tx.select().from(schema.payments).where(eq(schema.payments.id, input.paymentId)).for("update");
    if (!p) throw new SaleError("Payment not found.");
    if (p.method === "store_credit") throw new SaleError("This was paid with store credit; refund it to the original payment instead.");
    const [sale] = await tx.select().from(schema.sales).where(eq(schema.sales.id, p.saleId)).for("update");
    if (!sale!.clientId) throw new SaleError("Store credit needs a client on the ticket.");
    const planned = input.items?.length ? await planRefundItems(tx, sale!, input.items) : null;
    const refundable = p.amountCents - p.refundedCents - (await creditedAgainstPayment(tx, p.id));
    const wanted = planned ? planned.reduce((n, x) => n + x.amountCents, 0) : input.amountCents;
    if (planned && wanted > refundable) throw new SaleError(`That's ${(wanted / 100).toFixed(2)}, more than the ${(refundable / 100).toFixed(2)} left on this payment. Refund some of it from another payment.`);
    const amount = Math.min(wanted, refundable);
    if (amount <= 0) throw new SaleError("Nothing left to refund.");
    await changeStoreCredit(tx, { businessId: input.businessId, clientId: sale!.clientId!, deltaCents: amount, reason: "refund", saleId: sale!.id, paymentId: p.id, refundReasonId: input.reasonId ?? null, note: input.reason, actorUserId: input.actorUserId });
    if (planned) {
      const [ledger] = await tx.select({ id: schema.storeCreditLedger.id }).from(schema.storeCreditLedger).where(and(eq(schema.storeCreditLedger.paymentId, p.id), eq(schema.storeCreditLedger.reason, "refund"))).orderBy(desc(schema.storeCreditLedger.createdAt)).limit(1);
      stopBilling.push(...(await recordRefundItems(tx, input.businessId, sale!, planned, { creditLedgerId: ledger!.id }, input.actorUserId)));
    }
    await audit(tx, input.businessId, input.actorUserId, "payment.refund_store_credit", sale!.id, { paymentId: p.id, amount, reasonId: input.reasonId ?? null, note: input.reason, items: planned?.map((x) => ({ line: x.line.name, cents: x.amountCents })) });
  });
  await stopMembershipBilling(input.businessId, stopBilling, input.actorUserId);
}

/** Spend store credit on an open ticket. */
export async function payWithStoreCredit(input: { businessId: string; saleId: string; amountCents: number; actorUserId: string; taxRateBps: number }) {
  await withTenant(input.businessId, async (tx) => {
    const sale = await tx.query.sales.findFirst({ where: eq(schema.sales.id, input.saleId) });
    if (!sale) throw new SaleError("Sale not found.");
    assertOpen(sale);
    if (!sale.clientId) throw new SaleError("Store credit needs a client on the ticket.");
    const due = balance(sale);
    if (input.amountCents <= 0) throw new SaleError("Enter an amount.");
    const amount = Math.min(input.amountCents, due);
    if (amount <= 0) throw new SaleError("Nothing left to pay.");
    const [row] = await tx
      .insert(schema.payments)
      .values({ businessId: input.businessId, saleId: sale.id, method: "store_credit", status: "succeeded", amountCents: amount, tipCents: tipShare(sale, amount), note: "Store credit", createdByUserId: input.actorUserId })
      .returning({ id: schema.payments.id });
    await changeStoreCredit(tx, { businessId: input.businessId, clientId: sale.clientId, deltaCents: -amount, reason: "payment", saleId: sale.id, paymentId: row!.id, note: `Sale #${sale.number}`, actorUserId: input.actorUserId });
    await audit(tx, input.businessId, input.actorUserId, "payment.store_credit", sale.id, { amount });
    await closeIfPaid(tx, sale.id, input.taxRateBps, input.actorUserId, input.businessId);
  });
}

/**
 * Charge a saved card (off-session) on the business's Stripe account.
 * Money goes straight to the business; an optional platform fee is taken.
 *
 * The Stripe call happens between two short transactions, never inside one: first the sale is locked and a pending payment row committed
 * (so a second click sees the charge in flight and is refused, instead of charging the balance again), then the card is charged with that
 * row's id as the idempotency key and in the metadata, then the row is settled. If the app dies after the charge, the webhook finds the row
 * by that id and settles it; nothing is ever charged without a row to show for it.
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
  const prep = await withTenant(input.businessId, async (tx) => {
    const [sale] = await tx.select().from(schema.sales).where(eq(schema.sales.id, input.saleId)).for("update");
    if (!sale) throw new SaleError("Sale not found.");
    assertOpen(sale);
    if (!sale.clientId) throw new SaleError("Attach a client to use a saved card.");
    const client = await tx.query.clients.findFirst({ where: eq(schema.clients.id, sale.clientId) });
    if (!client) throw new SaleError("Client not found.");
    const [inflight] = await tx
      .select({ cents: sql<number>`coalesce(sum(${schema.payments.amountCents}), 0)::int` })
      .from(schema.payments)
      .where(and(eq(schema.payments.saleId, sale.id), eq(schema.payments.status, "pending"), eq(schema.payments.method, "card_on_file"), sql`${schema.payments.createdAt} > now() - interval '10 minutes'`));
    const amount = Math.min(input.amountCents, balance(sale) - (inflight?.cents ?? 0));
    if ((inflight?.cents ?? 0) > 0 && amount < 50) throw new SaleError("A card payment for this ticket is already being charged. Wait a moment and reload.");
    if (amount < 50) throw new SaleError("Amount must be at least $0.50.");
    const fee = Math.round((amount * (await platformFeeBpsFor(input.businessId, tx))) / 10_000);
    const [pending] = await tx
      .insert(schema.payments)
      .values({ businessId: input.businessId, saleId: sale.id, method: "card_on_file", status: "pending", amountCents: amount, tipCents: tipShare(sale, amount), stripeAccountId: input.accountId, createdByUserId: input.actorUserId })
      .returning({ id: schema.payments.id });
    return { sale, client, amount, fee, paymentId: pending!.id };
  });
  const { sale, client, amount, fee, paymentId } = prep;
  let pi;
  try {
    const customerId = await ensureStripeCustomer({ accountId: input.accountId, businessId: input.businessId, client });
    pi = await stripe().paymentIntents.create(
      {
        amount,
        currency: sale.currency,
        customer: customerId,
        payment_method: input.paymentMethodId,
        off_session: true,
        confirm: true,
        description: `Sale #${sale.number}`,
        metadata: { businessId: input.businessId, saleId: sale.id, paymentId },
        expand: ["latest_charge"],
        ...(fee > 0 ? { application_fee_amount: fee } : {}),
      },
      { stripeAccount: input.accountId, idempotencyKey: `pay_${paymentId}` },
    );
  } catch (e) {
    await failPendingPayment(input.businessId, paymentId, (e as Error).message);
    throw new SaleError(`Card declined: ${(e as Error).message}`);
  }
  const charge = typeof pi.latest_charge === "object" && pi.latest_charge ? pi.latest_charge : null;
  return withTenant(input.businessId, async (tx) => {
    await tx
      .update(schema.payments)
      .set({
        status: pi.status === "succeeded" ? "succeeded" : "pending",
        stripePaymentIntentId: pi.id,
        stripeChargeId: charge?.id ?? (typeof pi.latest_charge === "string" ? pi.latest_charge : null),
        cardBrand: charge?.payment_method_details?.card?.brand ?? null,
        cardLast4: charge?.payment_method_details?.card?.last4 ?? null,
      })
      .where(and(eq(schema.payments.id, paymentId), eq(schema.payments.status, "pending")));
    await audit(tx, input.businessId, input.actorUserId, "payment.card_on_file", sale.id, { amount, pi: pi.id });
    if (pi.status === "succeeded") await closeIfPaid(tx, sale.id, input.taxRateBps, input.actorUserId, input.businessId);
    return pi.status;
  });
}

/**
 * Create a PaymentIntent for a new card entered in the browser (Payment Element). The pending row is saved first, then Stripe is called
 * with no transaction open (a slow Stripe must not hold database connections), then the PaymentIntent id is saved on the row.
 */
export async function createCardPaymentIntent(input: {
  businessId: string;
  accountId: string;
  saleId: string;
  amountCents: number;
  saveCard: boolean;
  actorUserId: string;
  /** The card is tapped, dipped or swiped on a reader rather than typed in. */
  terminal?: boolean;
}) {
  // A card attempt that was abandoned (form closed, reader cancelled, page reloaded) must not pile up as "Pending" rows: cancel its PaymentIntent and
  // drop the row. A row whose PaymentIntent can't be cancelled (it may have just succeeded) is left for the webhook / finish step to settle.
  const abandoned = await withTenant(input.businessId, (tx) => tx.select().from(schema.payments).where(and(eq(schema.payments.saleId, input.saleId), eq(schema.payments.status, "pending"))));
  for (const old of abandoned) {
    if (old.stripePaymentIntentId) {
      // Cancel it; if Stripe refuses, it is gone only when it is already cancelled (a payment that succeeded must stay).
      const acct = old.stripeAccountId ?? input.accountId;
      const cancelled = await stripe().paymentIntents.cancel(old.stripePaymentIntentId, {}, { stripeAccount: acct }).then(
        () => true,
        async () => (await stripe().paymentIntents.retrieve(old.stripePaymentIntentId!, {}, { stripeAccount: acct }).then((p) => p.status === "canceled", () => false)),
      );
      if (!cancelled) continue;
    }
    await withTenant(input.businessId, (tx) => tx.delete(schema.payments).where(and(eq(schema.payments.id, old.id), eq(schema.payments.status, "pending"))));
  }
  const { sale, pending, amount, client, fee } = await withTenant(input.businessId, async (tx) => {
    const [sale] = await tx.select().from(schema.sales).where(eq(schema.sales.id, input.saleId)).for("update");
    if (!sale) throw new SaleError("Sale not found.");
    assertOpen(sale);
    const amount = Math.min(input.amountCents, balance(sale));
    if (amount < 50) throw new SaleError("Amount must be at least $0.50.");
    const client = sale.clientId ? await tx.query.clients.findFirst({ where: eq(schema.clients.id, sale.clientId) }) : undefined;
    const [pending] = await tx
      .insert(schema.payments)
      .values({
        businessId: input.businessId,
        saleId: sale.id,
        method: input.terminal ? "terminal" : "card",
        status: "pending",
        amountCents: amount,
        tipCents: tipShare(sale, amount),
        stripeAccountId: input.accountId,
        createdByUserId: input.actorUserId,
      })
      .returning();
    const fee = Math.round((amount * (await platformFeeBpsFor(input.businessId, tx))) / 10_000);
    return { sale, pending: pending!, amount, client, fee };
  });
  try {
    const customerId = client ? await ensureStripeCustomer({ accountId: input.accountId, businessId: input.businessId, client }) : undefined;
    const pi = await stripe().paymentIntents.create(
      {
        amount,
        currency: sale.currency,
        customer: customerId,
        description: `Sale #${sale.number}`,
        // The desk takes cards only: a typed card or a reader. (Klarna, Affirm, Cash App Pay and the like are for online checkout, not a client standing at the counter.)
        allowed_payment_method_types: input.terminal ? ["card_present"] : ["card"],
        ...(input.terminal ? { capture_method: "automatic" as const } : {}),
        ...(input.saveCard && customerId ? { setup_future_usage: "off_session" as const } : {}),
        metadata: { businessId: input.businessId, saleId: sale.id, paymentId: pending.id },
        ...(fee > 0 ? { application_fee_amount: fee } : {}),
      },
      { stripeAccount: input.accountId, idempotencyKey: `pi_${pending.id}` },
    );
    await withTenant(input.businessId, (tx) => tx.update(schema.payments).set({ stripePaymentIntentId: pi.id }).where(eq(schema.payments.id, pending.id)));
    return { clientSecret: pi.client_secret!, paymentId: pending.id, amount };
  } catch (e) {
    // Nothing was charged: don't leave a "Pending" row behind.
    await withTenant(input.businessId, (tx) => tx.delete(schema.payments).where(and(eq(schema.payments.id, pending.id), eq(schema.payments.status, "pending"), sql`${schema.payments.stripePaymentIntentId} is null`)));
    throw e;
  }
}

/**
 * Called by the webhook (or a return URL) when Stripe says a PaymentIntent succeeded. The row is found by the PaymentIntent id, or, when the
 * app stopped between charging and saving that id, by the payment id the charge carries in its metadata.
 */
export async function markCardPaymentSucceeded(input: {
  businessId: string;
  paymentIntentId: string;
  chargeId: string | null;
  card: { brand: string | null; last4: string | null };
  taxRateBps: number;
  metadata?: Record<string, string>;
}) {
  await withTenant(input.businessId, async (tx) => {
    let p = await tx.query.payments.findFirst({ where: eq(schema.payments.stripePaymentIntentId, input.paymentIntentId) });
    const byMeta = input.metadata?.paymentId && input.metadata.businessId === input.businessId ? input.metadata.paymentId : null;
    if (!p && byMeta) p = await tx.query.payments.findFirst({ where: and(eq(schema.payments.id, byMeta), sql`${schema.payments.stripePaymentIntentId} is null`) });
    if (!p || p.status === "succeeded") return;
    const card = { stripePaymentIntentId: input.paymentIntentId, stripeChargeId: input.chargeId, cardBrand: input.card.brand, cardLast4: input.card.last4 };
    if (p.note === LATE_TIP_NOTE && input.metadata?.tipFor) {
      await settleLateTip(tx, input.businessId, p.id, input.metadata.tipFor, "card", input.taxRateBps, p.createdByUserId ?? "system", card);
      return;
    }
    await tx.update(schema.payments).set({ status: "succeeded", ...card }).where(eq(schema.payments.id, p.id));
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
  /** Free-text note. */
  reason: string | null;
  /** Managed reason (refund_reasons.id). */
  reasonId?: string | null;
  actorUserId: string;
  taxRateBps: number;
  /** The lines being refunded; the amount is then their sum. */
  items?: RefundItemInput[];
  /** Already refunded in Stripe's dashboard (reported by the webhook): record it, don't refund again. */
  externalRefundId?: string | null;
  /** With externalRefundId: Stripe's total refunded on the payment. Only what we haven't recorded yet is booked (worked out under the lock). */
  externalTotalCents?: number;
}) {
  // Checked under lock; when the money goes back through Stripe, the call is made after this commits (no transaction held open while
  // Stripe answers) and the refund is recorded in a second transaction.
  const prep = await withTenant(input.businessId, async (tx) => {
    // Locked: two refund clicks must not both give a gift card or store credit its balance back.
    const [p] = await tx.select().from(schema.payments).where(eq(schema.payments.id, input.paymentId)).for("update");
    if (!p) throw new SaleError("Payment not found.");
    if (!["succeeded", "partially_refunded", "refunded"].includes(p.status)) throw new SaleError("Only a completed payment can be refunded.");
    // A card payment with no Stripe reference (e.g. a renewal recorded before its PaymentIntent was known) can't be refunded from here:
    // recording it would say the money went back when it didn't.
    if (["card", "card_on_file", "terminal"].includes(p.method) && !p.stripePaymentIntentId) throw new SaleError("This card payment has no Stripe reference, so it can't be refunded here. Refund it in your Stripe dashboard.");
    // With items, the ticket is locked too (two refunds from different payments must not both refund the same line) and checked first.
    const planned = input.items?.length ? await planRefundItems(tx, (await tx.select().from(schema.sales).where(eq(schema.sales.id, p.saleId)).for("update"))[0]!, input.items) : null;
    const refundable = p.amountCents - p.refundedCents - (await creditedAgainstPayment(tx, p.id));
    // A Stripe-side refund we may have just recorded ourselves (our own refund's webhook can arrive while we commit): book only the gap.
    if (input.externalRefundId && input.externalTotalCents !== undefined && input.externalTotalCents - p.refundedCents <= 0) return null;
    const wanted = planned ? planned.reduce((n, x) => n + x.amountCents, 0) : input.externalRefundId && input.externalTotalCents !== undefined ? input.externalTotalCents - p.refundedCents : input.amountCents;
    if (planned && wanted > refundable) throw new SaleError(`That's ${(wanted / 100).toFixed(2)}, more than the ${(refundable / 100).toFixed(2)} left on this payment. Refund some of it from another payment.`);
    const amount = Math.min(wanted, refundable);
    if (amount <= 0) throw new SaleError("Nothing left to refund.");
    const viaStripe = !!p.stripePaymentIntentId && !input.externalRefundId;
    // No Stripe call (cash, gift card, points, store credit, or a refund Stripe already made): record it in this same transaction.
    if (!viaStripe) return { done: await recordRefund(tx, input, p, amount, planned, input.externalRefundId ?? null) };
    // Back through the account that took it, even if the location now uses another one.
    const account = p.stripeAccountId ?? input.accountId;
    if (!account) throw new SaleError("Stripe account not connected.");
    return { stripe: { p, amount, account } };
  });
  if (!prep) return;
  if ("done" in prep) {
    await stopMembershipBilling(input.businessId, prep.done!, input.actorUserId);
    return;
  }
  const { p: before, amount, account } = prep.stripe;
  // Keyed on the running total, so a double click (or a retry) is one refund in Stripe.
  const r = await stripe().refunds.create(
    { payment_intent: before.stripePaymentIntentId!, amount, reason: "requested_by_customer", metadata: { paymentId: before.id } },
    { stripeAccount: account, idempotencyKey: `rf_${before.id}_${before.refundedCents + amount}` },
  );
  const stopBilling = await withTenant(input.businessId, async (tx) => {
    const [p] = await tx.select().from(schema.payments).where(eq(schema.payments.id, input.paymentId)).for("update");
    // Already recorded: the twin of a double click, or the webhook got here first (then add the items it couldn't know about).
    const [known] = await tx.select().from(schema.refunds).where(eq(schema.refunds.stripeRefundId, r.id));
    if (known) {
      const [hasItems] = await tx.select({ n: sql<number>`count(*)` }).from(schema.refundItems).where(eq(schema.refundItems.refundId, known.id));
      if (!input.items?.length || Number(hasItems?.n ?? 0) > 0) return [];
      const sale = (await tx.select().from(schema.sales).where(eq(schema.sales.id, p!.saleId)).for("update"))[0]!;
      const planned = await planRefundItems(tx, sale, input.items).catch(() => null);
      return planned ? recordRefundItems(tx, input.businessId, sale, planned, { refundId: known.id }, input.actorUserId) : [];
    }
    // The money has gone back: record it even if the lines changed meanwhile (then without the item breakdown).
    const sale = (await tx.select().from(schema.sales).where(eq(schema.sales.id, p!.saleId)).for("update"))[0]!;
    const planned = input.items?.length ? await planRefundItems(tx, sale, input.items).catch(() => null) : null;
    return recordRefund(tx, input, p!, amount, planned, r.id);
  });
  await stopMembershipBilling(input.businessId, stopBilling, input.actorUserId);
}

/** Save a refund that has happened (or needs no outside call), and undo what it covers. Returns memberships whose billing must stop. */
async function recordRefund(
  tx: TenantDb,
  input: { businessId: string; reason: string | null; reasonId?: string | null; actorUserId: string; taxRateBps: number; externalRefundId?: string | null },
  p: typeof schema.payments.$inferSelect,
  amount: number,
  planned: PlannedItem[] | null,
  stripeRefundId: string | null,
): Promise<string[]> {
  const stopBilling: string[] = [];
  const [refundRow] = await tx
    .insert(schema.refunds)
    .values({
      businessId: input.businessId,
      paymentId: p.id,
      amountCents: amount,
      reason: input.reason,
      reasonId: input.reasonId ?? null,
      stripeRefundId,
      createdByUserId: input.externalRefundId ? null : input.actorUserId,
    })
    .returning({ id: schema.refunds.id });
  const newRefunded = p.refundedCents + amount;
  // The tip part of the payment shrinks in proportion, so tip reports and payroll follow the refund.
  const tipRefund = p.amountCents > 0 ? Math.min(p.tipCents, Math.round((p.tipCents * amount) / p.amountCents)) : 0;
  await tx
    .update(schema.payments)
    .set({ refundedCents: newRefunded, tipCents: p.tipCents - tipRefund, status: newRefunded >= p.amountCents ? "refunded" : "partially_refunded" })
    .where(eq(schema.payments.id, p.id));
  const sale = (await tx.query.sales.findFirst({ where: eq(schema.sales.id, p.saleId) }))!;
  if (planned) stopBilling.push(...(await recordRefundItems(tx, input.businessId, sale, planned, { refundId: refundRow!.id }, input.actorUserId)));
  // Refunding a points payment gives the points back.
  if (p.method === "loyalty" && sale.clientId) {
    const biz = await tx.query.businesses.findFirst({ where: eq(schema.businesses.id, input.businessId), columns: { loyaltyPointValueCents: true } });
    const points = Math.round(amount / Math.max(1, biz?.loyaltyPointValueCents ?? 1));
    if (points > 0) await tx.insert(schema.loyaltyLedger).values({ businessId: input.businessId, clientId: sale.clientId, delta: points, reason: "adjust", saleId: sale.id, note: `Refund on sale #${sale.number}`, createdByUserId: input.actorUserId }).onConflictDoNothing();
  }
  // Refunding a gift card payment puts the money back on the card.
  if (p.method === "gift_card" && p.giftCardId) {
    await tx.update(schema.giftCards).set({ balanceCents: sql`${schema.giftCards.balanceCents} + ${amount}`, active: true }).where(eq(schema.giftCards.id, p.giftCardId));
  }
  // Refunding a store-credit payment puts the credit back on the client's account.
  if (p.method === "store_credit" && sale.clientId) {
    await changeStoreCredit(tx, { businessId: input.businessId, clientId: sale.clientId, deltaCents: amount, reason: "payment_refund", saleId: sale.id, paymentId: p.id, note: `Refund on sale #${sale.number}`, actorUserId: input.actorUserId });
  }
  const t = await recompute(tx, sale.id, input.taxRateBps, await currentDiscount(tx, sale));
  if (t.refundedCents >= t.paidCents && t.paidCents > 0) {
    await tx.update(schema.sales).set({ status: "refunded" }).where(eq(schema.sales.id, sale.id));
    stopBilling.push(...(await unwindPaidSale(tx, input.businessId, sale, input.actorUserId)));
  }
  await audit(tx, input.businessId, input.actorUserId, "payment.refund", sale.id, { paymentId: p.id, amount, items: planned?.map((x) => ({ line: x.line.name, cents: x.amountCents })) });
  return stopBilling;
}

/**
 * A refund made in Stripe's own dashboard (the webhook's charge.refunded): whatever Stripe says is refunded beyond what we recorded is
 * booked here as a refund on that payment, so sales, reports and payroll agree with Stripe. Returns the cents recorded (0 when we already
 * knew). A deposit not yet on a ticket is marked refunded on its appointment instead.
 */
export async function recordStripeSideRefund(input: { businessId: string; paymentIntentId: string; refundedTotalCents: number; refundId: string | null; taxRateBps: number }): Promise<number> {
  const p = await withTenant(input.businessId, (tx) => tx.query.payments.findFirst({ where: eq(schema.payments.stripePaymentIntentId, input.paymentIntentId) }));
  if (p) {
    const missing = input.refundedTotalCents - p.refundedCents;
    if (missing <= 0) return 0;
    await refundPayment({ businessId: input.businessId, accountId: p.stripeAccountId, paymentId: p.id, amountCents: missing, reason: "Refunded in Stripe", actorUserId: "stripe", taxRateBps: input.taxRateBps, externalRefundId: input.refundId ?? `stripe:${input.paymentIntentId}:${input.refundedTotalCents}`, externalTotalCents: input.refundedTotalCents });
    return missing;
  }
  return withTenant(input.businessId, async (tx) => {
    const [appt] = await tx.select().from(schema.appointments).where(eq(schema.appointments.depositPaymentIntentId, input.paymentIntentId)).for("update");
    if (!appt || appt.depositStatus !== "paid") return 0;
    const kept = Math.max(0, appt.depositCents - input.refundedTotalCents);
    await tx.update(schema.appointments).set(kept > 0 ? { depositCents: kept } : { depositStatus: "refunded" }).where(eq(schema.appointments.id, appt.id));
    await tx.insert(schema.auditLog).values({ businessId: input.businessId, actorUserId: null, action: "deposit.refund_in_stripe", entity: "appointment", entityId: appt.id, diff: JSON.stringify({ refundedCents: input.refundedTotalCents }) });
    return Math.min(appt.depositCents, input.refundedTotalCents);
  });
}

/**
 * Everything closeIfPaid did for a sale, undone once it is fully refunded:
 * earned points taken back, the promo use released,
 * unused gift cards deactivated and untouched packages removed. Idempotent.
 * A partly used gift card or package is left alone (the owner decides).
 * Goods are NOT put back on the shelf: a refund can be for "never arrived" or goodwill, and the product is gone either way.
 * When a client really brings something back, record it with returnToShelf (inventory).
 */
async function unwindPaidSale(tx: TenantDb, businessId: string, sale: Sale, actorUserId: string): Promise<string[]> {
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
  // Memberships on the ticket, unless an itemized refund of that line already undid them.
  const stopBilling: string[] = [];
  const memberships = await tx.select().from(schema.saleLines).where(and(eq(schema.saleLines.saleId, sale.id), eq(schema.saleLines.kind, "membership")));
  for (const line of memberships) {
    const [done] = await tx.select({ n: sql<number>`count(*)` }).from(schema.refundItems).where(eq(schema.refundItems.saleLineId, line.id));
    if (Number(done?.n ?? 0) > 0) continue;
    const stop = await undoMembershipLine(tx, businessId, sale, line, actorUserId);
    if (stop) stopBilling.push(stop);
  }
  return stopBilling;
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
/**
 * Sales between two instants. With `serviceIds`, only sales that include a service line for one of them are counted
 * (every line on those sales is then included, so a ticket with a facial and a product shows both).
 */
export async function salesReport(businessId: string, from: Date, to: Date, locationId?: string | null, serviceIds?: string[] | null) {
  return withTenant(businessId, async (tx) => {
    const hasService = serviceIds ? (serviceIds.length ? sql`exists (select 1 from sale_lines sl_svc where sl_svc.sale_id = ${schema.sales.id} and sl_svc.kind = 'service' and sl_svc.service_id in (${sql.join(serviceIds.map((id) => sql`${id}`), sql`, `)}))` : sql`false`) : undefined;
    const closed = and(
      gte(schema.sales.closedAt, from),
      lt(schema.sales.closedAt, to),
      sql`${schema.sales.status} in ('paid','refunded')`,
      ...(locationId ? [eq(schema.sales.locationId, locationId)] : []),
      ...(hasService ? [hasService] : []),
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
          // Net of each line's share of the ticket discount, like payroll.
          services: sql<number>`coalesce(round(sum(${schema.saleLines.amountCents} * (1 - ${schema.sales.discountCents}::numeric / nullif(${schema.sales.subtotalCents}, 0))) filter (where ${schema.saleLines.kind} = 'service')), 0)`,
          products: sql<number>`coalesce(round(sum(${schema.saleLines.amountCents} * (1 - ${schema.sales.discountCents}::numeric / nullif(${schema.sales.subtotalCents}, 0))) filter (where ${schema.saleLines.kind} = 'product')), 0)`,
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
    const [byService, byCategory, appts] = await Promise.all([
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
      // Service revenue per (leaf) category; the page rolls leaves up into their parents.
      tx
        .select({
          categoryId: schema.services.categoryId,
          count: sql<number>`count(*)`,
          amount: sql<number>`coalesce(sum(${schema.saleLines.amountCents}), 0)`,
        })
        .from(schema.saleLines)
        .innerJoin(schema.sales, eq(schema.sales.id, schema.saleLines.saleId))
        .leftJoin(schema.services, eq(schema.services.id, schema.saleLines.serviceId))
        .where(and(closed, eq(schema.saleLines.kind, "service")))
        .groupBy(schema.services.categoryId),
      tx
        .select({ status: schema.appointments.status, source: schema.appointments.source, count: sql<number>`count(*)` })
        .from(schema.appointments)
        .innerJoin(schema.appointmentItems, eq(schema.appointmentItems.appointmentId, schema.appointments.id))
        .where(and(gte(schema.appointmentItems.startAt, from), lt(schema.appointmentItems.startAt, to), eq(schema.appointmentItems.sortOrder, 0), eq(schema.appointments.kind, "visit"), ...(locationId ? [eq(schema.appointments.locationId, locationId)] : []), ...(serviceIds ? [serviceIds.length ? sql`exists (select 1 from appointment_items ai_svc where ai_svc.appointment_id = ${schema.appointments.id} and ai_svc.service_id in (${sql.join(serviceIds.map((id) => sql`${id}`), sql`, `)}))` : sql`false`] : [])))
        .groupBy(schema.appointments.status, schema.appointments.source),
    ]);
    // Per-location totals (always across all sites so the owner sees the split even when filtered).
    const allClosed = and(gte(schema.sales.closedAt, from), lt(schema.sales.closedAt, to), sql`${schema.sales.status} in ('paid','refunded')`, ...(hasService ? [hasService] : []));
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
    // Tips by how they were handed over, and what each payment method carried, worked out from the tip lines and the payments (not the stored proportional share).
    const saleIds = sales.map((r) => r.id);
    const [tipLines, payRows] = saleIds.length
      ? await Promise.all([
          tx.select({ saleId: schema.saleLines.saleId, amountCents: schema.saleLines.amountCents, method: schema.saleLines.tipMethod }).from(schema.saleLines).where(and(eq(schema.saleLines.kind, "tip"), sql`${schema.saleLines.saleId} in ${saleIds}`)),
          tx.select({ id: schema.payments.id, saleId: schema.payments.saleId, method: schema.payments.method, amountCents: schema.payments.amountCents }).from(schema.payments).where(and(sql`${schema.payments.saleId} in ${saleIds}`, sql`${schema.payments.status} in ('succeeded','partially_refunded','refunded')`)),
        ])
      : [[], []];
    let tipCashCents = 0;
    let tipCardCents = 0;
    const tipByMethod = new Map<string, number>();
    for (const id of saleIds) {
      const parts = tipLines.filter((t) => t.saleId === id).map((t) => ({ amountCents: t.amountCents, method: t.method === "cash" || t.method === "card" ? (t.method as "cash" | "card") : null }));
      if (!parts.length) continue;
      const pays = payRows.filter((p) => p.saleId === id);
      const paid = pays.reduce((n, p) => n + p.amountCents, 0);
      const cardPaid = pays.filter((p) => CARD_FEE_METHODS.has(p.method)).reduce((n, p) => n + p.amountCents, 0);
      const split = splitTips(parts, paid > 0 ? 1 - cardPaid / paid : 0);
      tipCashCents += split.cashCents;
      tipCardCents += split.cardCents;
      const per = tipsPerPayment(parts, pays);
      for (const p of pays) tipByMethod.set(p.method, (tipByMethod.get(p.method) ?? 0) + (per[p.id] ?? 0));
    }
    const byMethodReal = byMethod.map((m) => ({ ...m, tips: tipByMethod.get(m.method) ?? 0 }));
    // Refunds by the day they were made (whenever the sale was), so a month that has closed doesn't change when an old sale is refunded.
    const refundRows = await tx
      .select({ locationId: schema.sales.locationId, cents: sql<number>`coalesce(sum(${schema.refunds.amountCents}), 0)::int` })
      .from(schema.refunds)
      .innerJoin(schema.payments, eq(schema.payments.id, schema.refunds.paymentId))
      .innerJoin(schema.sales, eq(schema.sales.id, schema.payments.saleId))
      .where(and(gte(schema.refunds.createdAt, from), lt(schema.refunds.createdAt, to), ...(hasService ? [hasService] : [])))
      .groupBy(schema.sales.locationId);
    const refundsByLocation = new Map(refundRows.map((r) => [r.locationId, Number(r.cents)]));
    const refundsCents = refundRows.filter((r) => !locationId || r.locationId === locationId).reduce((n, r) => n + Number(r.cents), 0);
    return { sales, byStaff, byMethod: byMethodReal, byService, byCategory, appts, byLocation, crossLocation, tipCashCents, tipCardCents, refundsCents, refundsByLocation };
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
