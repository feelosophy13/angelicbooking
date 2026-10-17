import { and, asc, eq, gte, inArray, lte, or, sql } from "drizzle-orm";
import { db, schema, withTenant, type TenantDb } from "@angelic/db";
import { CARD_FEE_METHODS, computePayroll, weekStartOf, splitTips, zonedToInstant, type Adjustment, type HoursEntry, type PayrollEmployee, type PayrollLine, type PayrollResult, type TipPart } from "@angelic/core";
import { shiftISODate } from "@/lib/utils";
import { ratesForPeriod, syncCurrentRates } from "@/server/pay-rates";

export interface PayrollPeriod {
  start: string; // YYYY-MM-DD inclusive
  end: string; // inclusive
}

type Business = typeof schema.businesses.$inferSelect;

function localDate(at: Date, tz: string) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(at);
}

/**
 * Build payable lines for a period from closed sales. A service line is
 * credited to the date the appointment happened (so deposits taken earlier
 * land in the right period); products and other lines to the checkout date.
 * Discounts, tax and tips are allocated per line so the sheet's columns add up.
 *
 * Refunds are events on the day they happen, not edits to the past: a sale is always credited in full on its own date, and each refund
 * (to the card or as store credit) adds "Refund ·" rows with negative amounts on the refund's date, in proportion to the share of the
 * sale's payments refunded (goods and tips alike). So a refund after a period was paid comes off the next period's pay instead of
 * silently vanishing, and re-running a paid period gives the same numbers it gave then.
 */
export async function buildPayrollLines(business: Business, period: PayrollPeriod, locationId?: string | null): Promise<PayrollLine[]> {
  const tz = business.timezone;
  // Pull a wide window of closed sales (6 months back) because appointment dates
  // can precede or follow checkout; narrow by credited date below.
  const from = zonedToInstant(shiftISODate(period.start, -183), "00:00", tz);
  const to = zonedToInstant(shiftISODate(period.end, 31), "00:00", tz);
  // Refunds made in the period, whenever their sale was (a day of slack each side; narrowed by local date below).
  const refundFrom = zonedToInstant(shiftISODate(period.start, -1), "00:00", tz);
  const refundTo = zonedToInstant(shiftISODate(period.end, 2), "00:00", tz);
  return withTenant(business.id, async (tx) => {
    // Refunds that name their items claw back exactly those lines (itemEvents); the rest are spread over the ticket (refundEvents).
    const itemized = sql`exists (select 1 from refund_items ri where ri.refund_id = ${schema.refunds.id})`;
    const itemizedCredit = sql`exists (select 1 from refund_items ri where ri.credit_ledger_id = ${schema.storeCreditLedger.id})`;
    const [cardRefunds, creditRefunds, refundedItems] = await Promise.all([
      tx
        .select({ saleId: schema.payments.saleId, cents: schema.refunds.amountCents, at: schema.refunds.createdAt })
        .from(schema.refunds)
        .innerJoin(schema.payments, eq(schema.payments.id, schema.refunds.paymentId))
        .where(and(gte(schema.refunds.createdAt, refundFrom), lte(schema.refunds.createdAt, refundTo), sql`not ${itemized}`)),
      tx
        .select({ saleId: schema.storeCreditLedger.saleId, cents: schema.storeCreditLedger.deltaCents, at: schema.storeCreditLedger.createdAt })
        .from(schema.storeCreditLedger)
        .where(and(eq(schema.storeCreditLedger.reason, "refund"), sql`${schema.storeCreditLedger.saleId} is not null`, gte(schema.storeCreditLedger.createdAt, refundFrom), lte(schema.storeCreditLedger.createdAt, refundTo), sql`not ${itemizedCredit}`)),
      tx
        .select({ saleId: schema.refundItems.saleId, lineId: schema.refundItems.saleLineId, cents: schema.refundItems.amountCents, at: schema.refundItems.createdAt })
        .from(schema.refundItems)
        .where(and(gte(schema.refundItems.createdAt, refundFrom), lte(schema.refundItems.createdAt, refundTo))),
    ]);
    const inPeriod = (date: string) => date >= period.start && date <= period.end;
    const refundEvents = [...cardRefunds, ...creditRefunds]
      .map((r) => ({ saleId: r.saleId!, cents: r.cents, date: localDate(r.at, tz) }))
      .filter((r) => r.cents > 0 && inPeriod(r.date));
    const itemEvents = refundedItems.map((r) => ({ saleId: r.saleId, lineId: r.lineId, cents: r.cents, date: localDate(r.at, tz) })).filter((r) => inPeriod(r.date));
    // Tips added to a ticket after the day it closed are paid in the period they were added (not the closed one, which may be paid already).
    const lateTipSales = (
      await tx
        .select({ saleId: schema.saleLines.saleId, at: schema.saleLines.createdAt, closedAt: schema.sales.closedAt })
        .from(schema.saleLines)
        .innerJoin(schema.sales, eq(schema.sales.id, schema.saleLines.saleId))
        .where(and(eq(schema.saleLines.kind, "tip"), gte(schema.saleLines.createdAt, refundFrom), lte(schema.saleLines.createdAt, refundTo)))
    )
      .filter((t) => t.closedAt && localDate(t.at, tz) > localDate(t.closedAt, tz) && inPeriod(localDate(t.at, tz)))
      .map((t) => t.saleId);
    const refundSaleIds = [...new Set([...refundEvents, ...itemEvents].map((r) => r.saleId).concat(lateTipSales))];
    const sales = await tx
      .select()
      .from(schema.sales)
      .where(
        and(
          sql`${schema.sales.status} in ('paid','refunded')`,
          ...(locationId ? [eq(schema.sales.locationId, locationId)] : []),
          refundSaleIds.length ? or(and(gte(schema.sales.closedAt, from), lte(schema.sales.closedAt, to)), inArray(schema.sales.id, refundSaleIds)) : and(gte(schema.sales.closedAt, from), lte(schema.sales.closedAt, to)),
        ),
      );
    if (!sales.length) return [];
    const saleIds = sales.map((s) => s.id);
    const [lines, pays] = await Promise.all([
      tx.select().from(schema.saleLines).where(sql`${schema.saleLines.saleId} in ${saleIds}`).orderBy(asc(schema.saleLines.sortOrder)),
      tx.select().from(schema.payments).where(and(sql`${schema.payments.saleId} in ${saleIds}`, sql`${schema.payments.status} in ('succeeded','partially_refunded','refunded')`)),
    ]);
    // Only the names, users and visit times these sales need (not every row in the business, or every user on the platform).
    const clientIds = [...new Set(sales.map((s) => s.clientId).filter((x): x is string => !!x))];
    const userIds = [...new Set(sales.map((s) => s.createdByUserId).filter((x): x is string => !!x))];
    const itemIds = [...new Set(lines.map((l) => l.appointmentItemId).filter((x): x is string => !!x))];
    const [clients, users, items] = await Promise.all([
      clientIds.length ? tx.select({ id: schema.clients.id, first: schema.clients.firstName, last: schema.clients.lastName }).from(schema.clients).where(inArray(schema.clients.id, clientIds)) : [],
      userIds.length ? tx.select({ id: schema.user.id, name: schema.user.name }).from(schema.user).where(inArray(schema.user.id, userIds)) : [],
      itemIds.length ? tx.select({ id: schema.appointmentItems.id, startAt: schema.appointmentItems.startAt }).from(schema.appointmentItems).where(inArray(schema.appointmentItems.id, itemIds)) : [],
    ]);
    const clientName = new Map(clients.map((c) => [c.id, `${c.first} ${c.last}`.trim()]));
    const userName = new Map(users.map((u) => [u.id, u.name]));
    const itemStart = new Map(items.map((i) => [i.id, i.startAt]));

    const out: PayrollLine[] = [];
    for (const sale of sales) {
      const sl = lines.filter((l) => l.saleId === sale.id);
      const goods = sl.filter((l) => l.kind !== "tip");
      const checkoutDay = localDate(sale.closedAt ?? sale.createdAt, tz);
      const isLate = (t: (typeof sl)[number]) => localDate(t.createdAt, tz) > checkoutDay;
      const tips = sl.filter((l) => l.kind === "tip" && !isLate(l));
      const lateTips = sl.filter((l) => l.kind === "tip" && isLate(l));
      const goodsTotal = goods.reduce((s, l) => s + l.amountCents, 0);
      const taxableTotal = goods.filter((l) => l.taxable).reduce((s, l) => s + l.amountCents, 0);
      const sp = pays.filter((p) => p.saleId === sale.id);
      const paidTotal = sp.reduce((s, p) => s + p.amountCents, 0);
      // "Cash" on the sheet is money that did not go through a card (cash, other, a gift card, store credit, loyalty points); only a real card payment is "Credit Card"
      // and bears the card fee on tips.
      const cardPaid = sp.filter((p) => CARD_FEE_METHODS.has(p.method)).reduce((s, p) => s + p.amountCents, 0);
      const cashShare = paidTotal > 0 ? 1 - cardPaid / paidTotal : 0;
      const tipNoFeeShare = cashShare;
      const checkoutBy = sale.createdByUserId ? (userName.get(sale.createdByUserId) ?? null) : null;
      const customer = sale.clientId ? (clientName.get(sale.clientId) ?? "Walk-in") : "Walk-in";
      const checkoutDate = localDate(sale.closedAt ?? sale.createdAt, tz);

      // Tips per staff, attached to that staff's first service line (or a standalone row).
      const tipByStaff = new Map<string, TipPart[]>();
      for (const t of tips) if (t.staffId) tipByStaff.set(t.staffId, [...(tipByStaff.get(t.staffId) ?? []), { amountCents: t.amountCents, method: t.tipMethod === "cash" || t.tipMethod === "card" ? t.tipMethod : null }]);

      const base: PayrollLine[] = [];
      const baseByLine = new Map<string, PayrollLine>();
      const seenStaffTip = new Set<string>();
      for (const l of goods) {
        if (!l.staffId) continue;
        const disc = goodsTotal > 0 ? Math.round((sale.discountCents * l.amountCents) / goodsTotal) : 0;
        const tax = l.taxable && taxableTotal > 0 ? Math.round((sale.taxCents * l.amountCents) / taxableTotal) : 0;
        // A line covered by a package or membership credit carries its value in creditCents
        // (amountCents is 0 so the ticket adds up); the provider is still paid on it.
        const net = l.amountCents - disc + tax + (l.creditCents ?? 0);
        let tip = 0;
        let cashTip = 0;
        let cardTip = 0;
        if (l.kind === "service" && !seenStaffTip.has(l.staffId) && tipByStaff.has(l.staffId)) {
          const split = splitTips(tipByStaff.get(l.staffId)!, tipNoFeeShare);
          tip = split.totalCents;
          cashTip = split.cashCents;
          cardTip = split.cardCents;
          seenStaffTip.add(l.staffId);
        }
        const cash = Math.round(net * cashShare);
        const card = net - cash;
        // A package or membership sold at the desk is its own sale-line kind (not a product named "package"), so map it directly; gift cards and fees are not commissionable.
        const kind: PayrollLine["kind"] = l.kind === "service" ? "service" : l.kind === "package" ? "package" : l.kind === "membership" ? "membership" : l.kind === "product" ? (/package/i.test(l.name) ? "package" : /membership/i.test(l.name) ? "membership" : "product") : "fee";
        const start = l.appointmentItemId ? itemStart.get(l.appointmentItemId) : null;
        const row: PayrollLine = {
          staffId: l.staffId,
          kind,
          refunded: false,
          date: start ? localDate(start, tz) : checkoutDate,
          customer,
          name: l.name,
          checkoutBy,
          saleNumber: sale.number,
          cashCents: cash,
          cardCents: card,
          cashTipCents: cashTip,
          cardTipCents: cardTip,
          discountCents: disc,
          amtPaidCents: net + tip,
          locationId: sale.locationId,
        };
        base.push(row);
        baseByLine.set(l.id, row);
      }
      // Tips for staff with no goods line on this sale (rare) → standalone row.
      for (const [staffId, parts] of tipByStaff) {
        if (seenStaffTip.has(staffId)) continue;
        const split = splitTips(parts, tipNoFeeShare);
        base.push({ staffId, kind: "service", refunded: false, date: checkoutDate, customer, name: "Tip", checkoutBy, saleNumber: sale.number, cashCents: 0, cardCents: 0, cashTipCents: split.cashCents, cardTipCents: split.cardCents, discountCents: 0, amtPaidCents: split.totalCents, locationId: sale.locationId });
      }
      out.push(...base);
      // Tips added on a later day: a row of their own, on the day they were added.
      const late: PayrollLine[] = [];
      for (const t of lateTips) {
        if (!t.staffId) continue;
        const split = splitTips([{ amountCents: t.amountCents, method: t.tipMethod === "cash" || t.tipMethod === "card" ? t.tipMethod : null }], tipNoFeeShare);
        late.push({ staffId: t.staffId, kind: "service", refunded: false, date: localDate(t.createdAt, tz), customer, name: "Tip (added later)", checkoutBy, saleNumber: sale.number, cashCents: 0, cardCents: 0, cashTipCents: split.cashCents, cardTipCents: split.cardCents, discountCents: 0, amtPaidCents: split.totalCents, locationId: sale.locationId });
      }
      out.push(...late);
      // An itemized refund takes back exactly the line refunded, from whoever was credited on it, on the day it was refunded.
      for (const r of itemEvents.filter((e) => e.saleId === sale.id)) {
        const line = sl.find((x) => x.id === r.lineId);
        if (!line) continue;
        if (line.kind === "tip") {
          if (!line.staffId) continue;
          const split = splitTips([{ amountCents: r.cents, method: line.tipMethod === "cash" || line.tipMethod === "card" ? line.tipMethod : null }], tipNoFeeShare);
          out.push({ staffId: line.staffId, kind: "service", refunded: false, date: r.date, customer, name: "Refund · Tip", checkoutBy, saleNumber: sale.number, cashCents: 0, cardCents: 0, cashTipCents: -split.cashCents, cardTipCents: -split.cardCents, discountCents: 0, amtPaidCents: -split.totalCents, locationId: sale.locationId });
          continue;
        }
        const b = baseByLine.get(line.id);
        if (!b) continue; // nobody credited on it (a gift card with no stylist): no pay to take back
        const cash = Math.round(r.cents * cashShare);
        out.push({ ...b, date: r.date, name: `Refund · ${b.name}`, cashCents: -cash, cardCents: -(r.cents - cash), cashTipCents: 0, cardTipCents: 0, discountCents: 0, amtPaidCents: -r.cents });
      }
      // Each refund of this sale in the period takes back its share of every row, on the day it was refunded.
      if (paidTotal > 0) {
        for (const r of refundEvents.filter((e) => e.saleId === sale.id)) {
          const f = Math.min(1, r.cents / paidTotal);
          const back = (c: number) => -Math.round(c * f);
          for (const b of [...base, ...late]) {
            out.push({ ...b, date: r.date, name: `Refund · ${b.name}`, cashCents: back(b.cashCents), cardCents: back(b.cardCents), cashTipCents: back(b.cashTipCents), cardTipCents: back(b.cardTipCents), discountCents: 0, amtPaidCents: back(b.amtPaidCents) });
          }
        }
      }
    }
    return out.filter((l) => l.date >= period.start && l.date <= period.end);
  });
}

/**
 * `split` (with a `locationId`) apportions the pay that is not tied to a sale to that site, for
 * reports: hours are those clocked there, salary goes to people whose primary location it is, and
 * per-person adjustments are left out. Without it a location filter narrows sales only, so a pay
 * sheet still shows each person's whole pay.
 */
export async function getPayrollInputs(business: Business, period: PayrollPeriod, locationId?: string | null, opts: { split?: boolean } = {}) {
  const [lines, rest] = await Promise.all([
    buildPayrollLines(business, period, locationId),
    withTenant(business.id, async (tx) => {
      // Scheduled changes whose date has arrived land on the staff record here, so lists stay current.
      await syncCurrentRates(tx, localDate(new Date(), business.timezone));
      const [staff, hours, adjustments] = await Promise.all([
        tx.select().from(schema.staff).orderBy(asc(schema.staff.displayName)),
        tx
          .select({ staffId: schema.timeEntries.staffId, date: schema.timeEntries.date, minutes: schema.timeEntries.minutes, locationId: schema.timeEntries.locationId })
          .from(schema.timeEntries)
          // From the start of the first workweek, so overtime counts the week's earlier days (they aren't paid twice: see countFrom).
          .where(and(gte(schema.timeEntries.date, weekStartOf(period.start, 1)), lte(schema.timeEntries.date, period.end))),
        tx
          .select()
          .from(schema.payrollAdjustments)
          // An adjustment belongs to the period that contains the day it was dated from, so it shows once however the period's start and
          // end are picked (not only when they match the dates it was entered with).
          .where(and(gte(schema.payrollAdjustments.periodStart, period.start), lte(schema.payrollAdjustments.periodStart, period.end))),
      ]);
      // Pay settings as they stood in the period (an old period re-runs with its old rates; a change inside it splits the period).
      const rates = await ratesForPeriod(tx, staff.map((x) => x.id), period.start, period.end);
      return { staff, hours, adjustments, rates };
    }),
  ]);
  const split = !!opts.split && !!locationId;
  const employees: PayrollEmployee[] = rest.staff.map((s) => {
    const r = rest.rates.byStaff.get(s.id) ?? s;
    return {
      staffId: s.id,
      name: s.fullName?.trim() || s.displayName,
      position: s.position,
      payType: r.payType,
      mainCommissionBps: r.mainCommissionBps,
      productCommissionBps: r.productCommissionBps,
      ccTipFeeBps: r.ccTipFeeBps,
      hourlyRateCents: r.hourlyRateCents,
      salaryPerPeriodCents: split && s.locationId !== locationId ? 0 : r.salaryPerPeriodCents,
      overtimeOverride: r.overtimeOverride,
      taxDeductionCents: r.taxDeductionCents,
      taxDeductionBps: r.taxDeductionBps,
      // A change inside the period: each sale and worked day is paid at the rates in force that day.
      ratesFrom: rest.rates.segments.get(s.id)?.map((g) => ({ from: g.from, rates: { mainCommissionBps: g.rates.mainCommissionBps, productCommissionBps: g.rates.productCommissionBps, ccTipFeeBps: g.rates.ccTipFeeBps, hourlyRateCents: g.rates.hourlyRateCents } })),
    };
  });
  const hours: HoursEntry[] = rest.hours.filter((h) => !split || h.locationId === locationId).map((h) => ({ staffId: h.staffId, date: h.date, minutes: h.minutes }));
  const adjustments: Adjustment[] = split ? [] : rest.adjustments.map((a) => ({ staffId: a.staffId, label: a.label, amountCents: a.amountCents, countsAsPay: a.countsAsPay }));
  const nameOf = new Map(employees.map((e) => [e.staffId, e.name]));
  const rateChanges = rest.rates.changes.map((c) => ({ ...c, name: nameOf.get(c.staffId) ?? "" }));
  return {
    employees,
    lines,
    hours,
    adjustments,
    adjustmentRows: split ? [] : rest.adjustments,
    rateChanges,
    /** Every time entry with its site, and each person's primary site, for reporting by location. */
    hoursRaw: rest.hours,
    primaryLocation: new Map(rest.staff.map((s) => [s.id, s.locationId ?? null] as const)),
  };
}

/** `locationId` limits sales (commission, tips) to one site; hours and adjustments are per person and stay whole. */
export async function runPayroll(business: Business, period: PayrollPeriod, overtime: boolean, locationId?: string | null, opts: { split?: boolean } = {}): Promise<PayrollResult & { adjustmentRows: (typeof schema.payrollAdjustments.$inferSelect)[]; rateChanges: { staffId: string; name: string; effectiveFrom: string }[] }> {
  const inputs = await getPayrollInputs(business, period, locationId, opts);
  const result = computePayroll({ employees: inputs.employees, lines: inputs.lines, hours: inputs.hours, adjustments: inputs.adjustments, overtime, overtimeRule: business.overtimeRule, weekStart: 1, countFrom: period.start });
  return { ...result, adjustmentRows: inputs.adjustmentRows, rateChanges: inputs.rateChanges };
}

export interface LocationPay {
  mainCommissionCents: number;
  productCommissionCents: number;
  wageCents: number;
  totalCents: number;
  serviceRevenueCents: number;
}

/**
 * Pay by site for reports, in one pass: commission follows the sale's location, hourly pay follows
 * the time-clock location, salary is charged to the person's primary location, and per-person
 * adjustments are left out. Overtime off, like the Reports pay card. Key `null` is "no location".
 */
export async function payrollByLocation(business: Business, period: PayrollPeriod, locationIds: string[]): Promise<Map<string | null, LocationPay>> {
  const inputs = await getPayrollInputs(business, period);
  const out = new Map<string | null, LocationPay>();
  for (const key of [...locationIds, null]) {
    const employees = inputs.employees.map((e) => ({ ...e, salaryPerPeriodCents: (inputs.primaryLocation.get(e.staffId) ?? null) === key ? e.salaryPerPeriodCents : 0 }));
    const result = computePayroll({
      employees,
      lines: inputs.lines.filter((l) => (l.locationId ?? null) === key),
      hours: inputs.hoursRaw.filter((h) => (h.locationId ?? null) === key).map((h) => ({ staffId: h.staffId, date: h.date, minutes: h.minutes })),
      adjustments: [],
      overtime: false,
      weekStart: 1,
      countFrom: period.start,
    });
    const sum = (k: keyof LocationPay) => result.employees.reduce((n, e) => n + e[k], 0);
    out.set(key, { mainCommissionCents: sum("mainCommissionCents"), productCommissionCents: sum("productCommissionCents"), wageCents: sum("wageCents"), totalCents: sum("totalCents"), serviceRevenueCents: sum("serviceRevenueCents") });
  }
  return out;
}

export async function getFinalizedRun(businessId: string, period: PayrollPeriod) {
  return withTenant(businessId, (tx) => getFinalizedRunIn(tx, period));
}

export function getFinalizedRunIn(tx: TenantDb, period: PayrollPeriod) {
  return tx.query.payrollRuns.findFirst({ where: and(eq(schema.payrollRuns.periodStart, period.start), eq(schema.payrollRuns.periodEnd, period.end)) });
}

/** Each person's total in a saved snapshot (staff id → cents). */
export function snapshotTotals(snapshot: unknown): Map<string, number> {
  const emps = ((snapshot as { employees?: { employee?: { staffId?: string }; totalCents?: number }[] })?.employees ?? []);
  return new Map(emps.filter((e) => e.employee?.staffId).map((e) => [e.employee!.staffId!, Number(e.totalCents ?? 0)]));
}

/** Who would be paid differently now than the finalized snapshot says (late tips on old tickets, edits made before the locks existed). */
export function driftFromSnapshot(snapshot: unknown, live: PayrollResult): { staffId: string; name: string; wasCents: number; nowCents: number }[] {
  const was = snapshotTotals(snapshot);
  const out: { staffId: string; name: string; wasCents: number; nowCents: number }[] = [];
  for (const e of live.employees) {
    const before = was.get(e.employee.staffId) ?? 0;
    if (before !== e.totalCents && (e.hasActivity || before !== 0)) out.push({ staffId: e.employee.staffId, name: e.employee.name, wasCents: before, nowCents: e.totalCents });
  }
  return out;
}

export async function finalizePayroll(business: Business, period: PayrollPeriod, overtime: boolean, actorUserId: string) {
  const result = await runPayroll(business, period, overtime);
  const previous = await getFinalizedRun(business.id, period);
  await withTenant(business.id, async (tx) => {
    await tx
      .insert(schema.payrollRuns)
      .values({ businessId: business.id, periodStart: period.start, periodEnd: period.end, overtime, snapshot: result as unknown as Record<string, unknown>, createdByUserId: actorUserId })
      .onConflictDoUpdate({
        target: [schema.payrollRuns.businessId, schema.payrollRuns.periodStart, schema.payrollRuns.periodEnd],
        set: { snapshot: result as unknown as Record<string, unknown>, overtime, createdByUserId: actorUserId, createdAt: new Date() },
      });
    // Re-finalizing replaces the snapshot, so the log keeps what changed, person by person.
    const changes = previous ? driftFromSnapshot(previous.snapshot, result) : [];
    await tx.insert(schema.auditLog).values({ businessId: business.id, actorUserId, action: previous ? "payroll.refinalize" : "payroll.finalize", entity: "payroll_run", entityId: `${period.start}_${period.end}`, diff: previous ? JSON.stringify({ previouslyFinalizedAt: previous.createdAt, changes }) : null });
  });
  return result;
}

export async function listPayrollRuns(businessId: string) {
  return withTenant(businessId, (tx) =>
    tx
      .select({ id: schema.payrollRuns.id, periodStart: schema.payrollRuns.periodStart, periodEnd: schema.payrollRuns.periodEnd, createdAt: schema.payrollRuns.createdAt, overtime: schema.payrollRuns.overtime })
      .from(schema.payrollRuns)
      .orderBy(sql`${schema.payrollRuns.periodStart} desc`)
      .limit(24),
  );
}

/** Default period: the most recent full two weeks ending on the last Saturday... kept simple: last 14 days ending yesterday. */
export function defaultPeriod(today: string): PayrollPeriod {
  return { start: shiftISODate(today, -14), end: shiftISODate(today, -1) };
}
