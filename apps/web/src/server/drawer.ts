// End-of-day close-out: cash drawer sessions (open with a float, pay-ins and payouts, count and close) and the daily closing report.
import { and, asc, desc, eq, gte, inArray, isNotNull, lt, sql } from "drizzle-orm";
import { schema, withTenant, type TenantDb } from "@angelic/db";
import { formatMoney } from "@/lib/utils";
import { closeNeedsNote, closingReport, countDenominations, drawerFlows, expectedCash, OVER_SHORT_NOTE_CENTS, overShort, type ClosingReport, type DrawerFlows } from "@angelic/core";

export class DrawerError extends Error {
  constructor(message: string, public field?: string) {
    super(message);
  }
}

type Session = typeof schema.drawerSessions.$inferSelect;
type Movement = typeof schema.drawerMovements.$inferSelect;
const PAID = sql`in ('succeeded','partially_refunded','refunded')`;

async function audit(tx: TenantDb, businessId: string, actorUserId: string, action: string, entityId: string, diff: unknown) {
  await tx.insert(schema.auditLog).values({ businessId, actorUserId, action, entity: "drawer_session", entityId, diff: JSON.stringify(diff) });
}

/** The cash a drawer has taken in and paid out so far (or up to its close), and what it should hold. */
async function flowsOf(tx: TenantDb, s: Session) {
  const [pays, refunds, movements] = await Promise.all([
    tx
      .select({ id: schema.payments.id, saleId: schema.payments.saleId, number: schema.sales.number, amountCents: schema.payments.amountCents, tipCents: schema.payments.tipCents, createdAt: schema.payments.createdAt })
      .from(schema.payments)
      .innerJoin(schema.sales, eq(schema.sales.id, schema.payments.saleId))
      .where(and(eq(schema.payments.drawerSessionId, s.id), sql`${schema.payments.status} ${PAID}`))
      .orderBy(asc(schema.payments.createdAt)),
    tx
      .select({ id: schema.refunds.id, saleId: schema.payments.saleId, number: schema.sales.number, amountCents: schema.refunds.amountCents, createdAt: schema.refunds.createdAt })
      .from(schema.refunds)
      .innerJoin(schema.payments, eq(schema.payments.id, schema.refunds.paymentId))
      .innerJoin(schema.sales, eq(schema.sales.id, schema.payments.saleId))
      .where(eq(schema.refunds.drawerSessionId, s.id))
      .orderBy(asc(schema.refunds.createdAt)),
    tx
      .select({ m: schema.drawerMovements, staffName: schema.staff.displayName, byName: schema.user.name })
      .from(schema.drawerMovements)
      .leftJoin(schema.staff, eq(schema.staff.id, schema.drawerMovements.staffId))
      .leftJoin(schema.user, eq(schema.user.id, schema.drawerMovements.createdByUserId))
      .where(eq(schema.drawerMovements.sessionId, s.id))
      .orderBy(asc(schema.drawerMovements.createdAt)),
  ]);
  const flows = drawerFlows({ openingFloatCents: s.openingFloatCents, payments: pays, refunds, movements: movements.map((r) => r.m) });
  return { pays, refunds, movements: movements.map((r) => ({ ...r.m, staffName: r.staffName, byName: r.byName })), flows, expectedCents: expectedCash(flows) };
}

export type DrawerDetail = Session & {
  locationName: string;
  openedByName: string | null;
  closedByName: string | null;
  flows: DrawerFlows;
  /** Live while open; the figure stored at close once closed. */
  expectedCents: number;
  pays: Awaited<ReturnType<typeof flowsOf>>["pays"];
  refunds: Awaited<ReturnType<typeof flowsOf>>["refunds"];
  movements: (Movement & { staffName: string | null; byName: string | null })[];
};

const opener = sql<string | null>`(select name from "user" where id = ${schema.drawerSessions.openedByUserId})`;
const closer = sql<string | null>`(select name from "user" where id = ${schema.drawerSessions.closedByUserId})`;

export async function getDrawer(businessId: string, id: string): Promise<DrawerDetail | null> {
  return withTenant(businessId, async (tx) => {
    const [row] = await tx
      .select({ s: schema.drawerSessions, locationName: schema.locations.name, openedByName: opener, closedByName: closer })
      .from(schema.drawerSessions)
      .innerJoin(schema.locations, eq(schema.locations.id, schema.drawerSessions.locationId))
      .where(eq(schema.drawerSessions.id, id));
    if (!row) return null;
    const f = await flowsOf(tx, row.s);
    return { ...row.s, locationName: row.locationName, openedByName: row.openedByName, closedByName: row.closedByName, ...f, expectedCents: row.s.status === "closed" ? row.s.expectedCents! : f.expectedCents };
  });
}

/** The drawers open at a location right now, oldest first, with what each should hold. */
export async function openDrawers(businessId: string, locationId: string) {
  return withTenant(businessId, async (tx) => {
    const rows = await tx
      .select({ s: schema.drawerSessions, openedByName: opener })
      .from(schema.drawerSessions)
      .where(and(eq(schema.drawerSessions.locationId, locationId), eq(schema.drawerSessions.status, "open")))
      .orderBy(asc(schema.drawerSessions.openedAt));
    return Promise.all(rows.map(async (r) => ({ ...r.s, openedByName: r.openedByName, expectedCents: (await flowsOf(tx, r.s)).expectedCents })));
  });
}

/** The last count at this register, offered as tomorrow's float (most salons leave the same float in the drawer). */
export async function lastClose(businessId: string, locationId: string) {
  return withTenant(businessId, async (tx) =>
    tx.query.drawerSessions.findFirst({ where: and(eq(schema.drawerSessions.locationId, locationId), eq(schema.drawerSessions.status, "closed")), orderBy: desc(schema.drawerSessions.closedAt) }),
  );
}

export async function openDrawer(input: { businessId: string; locationId: string; register: string; openingFloatCents: number; actorUserId: string }): Promise<string> {
  const register = input.register.trim() || "Main";
  return withTenant(input.businessId, async (tx) => {
    const loc = await tx.query.locations.findFirst({ where: eq(schema.locations.id, input.locationId), columns: { id: true } });
    if (!loc) throw new DrawerError("Pick a location.");
    const already = await tx.query.drawerSessions.findFirst({ where: and(eq(schema.drawerSessions.locationId, input.locationId), eq(schema.drawerSessions.status, "open"), sql`lower(${schema.drawerSessions.register}) = lower(${register})`) });
    if (already) throw new DrawerError(`The ${register} drawer is already open here. Close it first, or give this one another name.`, "register");
    const [row] = await tx.insert(schema.drawerSessions).values({ businessId: input.businessId, locationId: input.locationId, register, openingFloatCents: input.openingFloatCents, openedByUserId: input.actorUserId }).returning({ id: schema.drawerSessions.id });
    await audit(tx, input.businessId, input.actorUserId, "drawer.open", row!.id, { locationId: input.locationId, register, openingFloatCents: input.openingFloatCents });
    return row!.id;
  });
}

export async function addDrawerMovement(input: { businessId: string; sessionId: string; kind: "pay_in" | "payout" | "tip_payout"; amountCents: number; reason: string; staffId?: string | null; actorUserId: string; currency?: string }) {
  if (input.amountCents <= 0) throw new DrawerError("Enter an amount.", "amount");
  await withTenant(input.businessId, async (tx) => {
    const [s] = await tx.select().from(schema.drawerSessions).where(eq(schema.drawerSessions.id, input.sessionId)).for("update");
    if (!s) throw new DrawerError("Drawer not found.");
    if (s.status !== "open") throw new DrawerError("This drawer is closed.");
    if (input.kind !== "pay_in") {
      const { expectedCents } = await flowsOf(tx, s);
      if (input.amountCents > expectedCents) throw new DrawerError(`The drawer should only hold ${formatMoney(expectedCents, input.currency)}.`, "amount");
    }
    const [m] = await tx.insert(schema.drawerMovements).values({ businessId: input.businessId, sessionId: s.id, kind: input.kind, amountCents: input.amountCents, reason: input.reason, staffId: input.kind === "tip_payout" ? (input.staffId ?? null) : null, createdByUserId: input.actorUserId }).returning({ id: schema.drawerMovements.id });
    await audit(tx, input.businessId, input.actorUserId, `drawer.${input.kind}`, s.id, { movementId: m!.id, amountCents: input.amountCents, reason: input.reason, staffId: input.staffId ?? null });
  });
}

/** A movement recorded by mistake, taken back while the drawer is still open. */
export async function removeDrawerMovement(input: { businessId: string; movementId: string; actorUserId: string }) {
  await withTenant(input.businessId, async (tx) => {
    const m = await tx.query.drawerMovements.findFirst({ where: eq(schema.drawerMovements.id, input.movementId) });
    if (!m) return;
    const [s] = await tx.select().from(schema.drawerSessions).where(eq(schema.drawerSessions.id, m.sessionId)).for("update");
    if (s?.status !== "open") throw new DrawerError("This drawer is closed.");
    await tx.delete(schema.drawerMovements).where(eq(schema.drawerMovements.id, m.id));
    await audit(tx, input.businessId, input.actorUserId, "drawer.movement_remove", s.id, { kind: m.kind, amountCents: m.amountCents, reason: m.reason });
  });
}

/**
 * Close a drawer with a count: either a total, or the number of each bill and coin (the total is then their sum). Expected cash is worked
 * out under the drawer's lock and stored, with the difference; a difference of more than OVER_SHORT_NOTE_CENTS needs a note.
 */
export async function closeDrawer(input: { businessId: string; sessionId: string; countedCents?: number | null; denominations?: Record<string, number> | null; note: string | null; actorUserId: string; currency?: string }) {
  const denoms = input.denominations && Object.values(input.denominations).some((n) => n > 0) ? input.denominations : null;
  const counted = denoms ? countDenominations(denoms) : input.countedCents;
  if (counted == null || counted < 0) throw new DrawerError("Enter the amount counted.", "counted");
  return withTenant(input.businessId, async (tx) => {
    const [s] = await tx.select().from(schema.drawerSessions).where(eq(schema.drawerSessions.id, input.sessionId)).for("update");
    if (!s) throw new DrawerError("Drawer not found.");
    if (s.status !== "open") throw new DrawerError("This drawer is already closed.");
    const { expectedCents } = await flowsOf(tx, s);
    const diff = overShort(counted, expectedCents);
    if (closeNeedsNote(diff) && !input.note?.trim()) throw new DrawerError(`The count is ${diff > 0 ? "over" : "short"} by more than ${formatMoney(OVER_SHORT_NOTE_CENTS, input.currency)}. Say what happened before closing.`, "note");
    await tx
      .update(schema.drawerSessions)
      .set({ status: "closed", closedAt: new Date(), closedByUserId: input.actorUserId, expectedCents, countedCents: counted, overShortCents: diff, denominations: denoms, closeNote: input.note?.trim() || null })
      .where(eq(schema.drawerSessions.id, s.id));
    await audit(tx, input.businessId, input.actorUserId, "drawer.close", s.id, { expectedCents, countedCents: counted, overShortCents: diff });
    return { expectedCents, countedCents: counted, overShortCents: diff };
  });
}

/** Closed drawers between two instants (by close time), newest first, optionally at one location. */
export async function drawerHistory(businessId: string, opts: { from: Date; to: Date; locationId?: string | null }) {
  return withTenant(businessId, (tx) =>
    tx
      .select({ s: schema.drawerSessions, locationName: schema.locations.name, openedByName: opener, closedByName: closer })
      .from(schema.drawerSessions)
      .innerJoin(schema.locations, eq(schema.locations.id, schema.drawerSessions.locationId))
      .where(and(eq(schema.drawerSessions.status, "closed"), gte(schema.drawerSessions.closedAt, opts.from), lt(schema.drawerSessions.closedAt, opts.to), ...(opts.locationId ? [eq(schema.drawerSessions.locationId, opts.locationId)] : [])))
      .orderBy(desc(schema.drawerSessions.closedAt)),
  );
}

export interface ClosingDay extends ClosingReport {
  /** Cash taken at the location on the day while no drawer was open (not in any drawer's expected cash). */
  unstampedCashCents: number;
  openTickets: { id: string; number: number; clientName: string; dueCents: number; createdAt: Date }[];
  drawers: Awaited<ReturnType<typeof drawerHistory>>;
  refundCount: number;
}

/** The closing (Z) report for one location and one business day [from, to). */
export async function closingDay(businessId: string, locationId: string, from: Date, to: Date): Promise<ClosingDay> {
  return withTenant(businessId, async (tx) => {
    const atLoc = eq(schema.sales.locationId, locationId);
    const [payRows, refundRows, ticketRows, depositRows, openRows] = await Promise.all([
      tx
        .select({ id: schema.payments.id, saleId: schema.payments.saleId, method: schema.payments.method, provider: schema.payments.provider, amountCents: schema.payments.amountCents, drawerSessionId: schema.payments.drawerSessionId, depositPi: schema.appointments.depositPaymentIntentId, pi: schema.payments.stripePaymentIntentId, invoice: schema.payments.providerInvoice })
        .from(schema.payments)
        .innerJoin(schema.sales, eq(schema.sales.id, schema.payments.saleId))
        .leftJoin(schema.appointments, eq(schema.appointments.id, schema.sales.appointmentId))
        .where(and(atLoc, gte(schema.payments.createdAt, from), lt(schema.payments.createdAt, to), sql`${schema.payments.status} ${PAID}`)),
      tx
        .select({ method: schema.payments.method, provider: schema.payments.provider, amountCents: schema.refunds.amountCents })
        .from(schema.refunds)
        .innerJoin(schema.payments, eq(schema.payments.id, schema.refunds.paymentId))
        .innerJoin(schema.sales, eq(schema.sales.id, schema.payments.saleId))
        .where(and(atLoc, gte(schema.refunds.createdAt, from), lt(schema.refunds.createdAt, to))),
      tx
        .select({
          saleId: schema.sales.id,
          subtotalCents: schema.sales.subtotalCents,
          discountCents: schema.sales.discountCents,
          taxCents: schema.sales.taxCents,
          tipCents: schema.sales.tipCents,
          totalCents: schema.sales.totalCents,
          servicesCents: sql<number>`coalesce((select sum(amount_cents) from sale_lines l where l.sale_id = "sales"."id" and l.kind = 'service'), 0)::int`,
          productsCents: sql<number>`coalesce((select sum(amount_cents) from sale_lines l where l.sale_id = "sales"."id" and l.kind = 'product'), 0)::int`,
        })
        .from(schema.sales)
        .where(and(atLoc, gte(schema.sales.closedAt, from), lt(schema.sales.closedAt, to), sql`${schema.sales.status} in ('paid','refunded')`)),
      tx
        .select({ provider: schema.appointments.depositProvider, amountCents: schema.appointments.depositCents })
        .from(schema.appointments)
        .where(and(eq(schema.appointments.locationId, locationId), gte(schema.appointments.createdAt, from), lt(schema.appointments.createdAt, to), sql`${schema.appointments.depositCents} > 0`, sql`${schema.appointments.depositStatus} <> 'none'`)),
      tx
        .select({ id: schema.sales.id, number: schema.sales.number, first: schema.clients.firstName, last: schema.clients.lastName, dueCents: sql<number>`(${schema.sales.totalCents} - ${schema.sales.paidCents})::int`, createdAt: schema.sales.createdAt })
        .from(schema.sales)
        .leftJoin(schema.clients, eq(schema.clients.id, schema.sales.clientId))
        .where(and(atLoc, eq(schema.sales.status, "open"), lt(schema.sales.createdAt, to), sql`${schema.sales.totalCents} > ${schema.sales.paidCents}`))
        .orderBy(asc(schema.sales.createdAt)),
    ]);
    const saleIds = ticketRows.map((t) => t.saleId);
    const [tipLines, ticketPays] = saleIds.length
      ? await Promise.all([
          tx.select({ saleId: schema.saleLines.saleId, amountCents: schema.saleLines.amountCents, method: schema.saleLines.tipMethod }).from(schema.saleLines).where(and(eq(schema.saleLines.kind, "tip"), inArray(schema.saleLines.saleId, saleIds))),
          tx.select({ id: schema.payments.id, saleId: schema.payments.saleId, method: schema.payments.method, amountCents: schema.payments.amountCents }).from(schema.payments).where(and(inArray(schema.payments.saleId, saleIds), sql`${schema.payments.status} ${PAID}`)),
        ])
      : [[], []];
    const report = closingReport({
      // A deposit paid at booking becomes a card payment on the ticket when it opens; it was charged (and paid out) on the booking day.
      payments: payRows.map((p) => ({ id: p.id, saleId: p.saleId, method: p.method, provider: p.provider, amountCents: p.amountCents, appliedDeposit: !!p.depositPi && (p.pi === p.depositPi || p.invoice === p.depositPi) })),
      refunds: refundRows,
      tickets: ticketRows.map((t) => ({
        ...t,
        tips: tipLines.filter((l) => l.saleId === t.saleId).map((l) => ({ amountCents: l.amountCents, method: l.method === "cash" || l.method === "card" ? l.method : null })),
        payments: ticketPays.filter((p) => p.saleId === t.saleId),
      })),
      deposits: depositRows,
    });
    const drawers = await tx
      .select({ s: schema.drawerSessions, locationName: schema.locations.name, openedByName: opener, closedByName: closer })
      .from(schema.drawerSessions)
      .innerJoin(schema.locations, eq(schema.locations.id, schema.drawerSessions.locationId))
      .where(and(eq(schema.drawerSessions.locationId, locationId), isNotNull(schema.drawerSessions.closedAt), gte(schema.drawerSessions.closedAt, from), lt(schema.drawerSessions.closedAt, to)))
      .orderBy(asc(schema.drawerSessions.closedAt));
    return {
      ...report,
      unstampedCashCents: payRows.filter((p) => p.method === "cash" && !p.drawerSessionId).reduce((n, p) => n + p.amountCents, 0),
      openTickets: openRows.map((r) => ({ id: r.id, number: r.number, clientName: `${r.first ?? ""} ${r.last ?? ""}`.trim() || "Walk-in", dueCents: Number(r.dueCents), createdAt: r.createdAt })),
      drawers,
      refundCount: refundRows.length,
    };
  });
}
