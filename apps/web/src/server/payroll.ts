import { and, asc, eq, gte, lte, sql } from "drizzle-orm";
import { db, schema, withTenant } from "@angelic/db";
import { CARD_FEE_METHODS, computePayroll, splitTips, zonedToInstant, type Adjustment, type HoursEntry, type PayrollEmployee, type PayrollLine, type PayrollResult, type TipPart } from "@angelic/core";
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
 */
export async function buildPayrollLines(business: Business, period: PayrollPeriod, locationId?: string | null): Promise<PayrollLine[]> {
  const tz = business.timezone;
  // Pull a wide window of closed sales (6 months back) because appointment dates
  // can precede or follow checkout; narrow by credited date below.
  const from = zonedToInstant(shiftISODate(period.start, -183), "00:00", tz);
  const to = zonedToInstant(shiftISODate(period.end, 31), "00:00", tz);
  return withTenant(business.id, async (tx) => {
    const sales = await tx
      .select()
      .from(schema.sales)
      .where(and(gte(schema.sales.closedAt, from), lte(schema.sales.closedAt, to), sql`${schema.sales.status} in ('paid','refunded')`, ...(locationId ? [eq(schema.sales.locationId, locationId)] : [])));
    if (!sales.length) return [];
    const saleIds = sales.map((s) => s.id);
    const [lines, pays, clients, users, items] = await Promise.all([
      tx.select().from(schema.saleLines).where(sql`${schema.saleLines.saleId} in ${saleIds}`).orderBy(asc(schema.saleLines.sortOrder)),
      tx.select().from(schema.payments).where(and(sql`${schema.payments.saleId} in ${saleIds}`, sql`${schema.payments.status} in ('succeeded','partially_refunded','refunded')`)),
      tx.select({ id: schema.clients.id, first: schema.clients.firstName, last: schema.clients.lastName }).from(schema.clients),
      db.select({ id: schema.user.id, name: schema.user.name }).from(schema.user),
      tx.select({ id: schema.appointmentItems.id, startAt: schema.appointmentItems.startAt }).from(schema.appointmentItems),
    ]);
    const clientName = new Map(clients.map((c) => [c.id, `${c.first} ${c.last}`.trim()]));
    const userName = new Map(users.map((u) => [u.id, u.name]));
    const itemStart = new Map(items.map((i) => [i.id, i.startAt]));

    const out: PayrollLine[] = [];
    for (const sale of sales) {
      const sl = lines.filter((l) => l.saleId === sale.id);
      const goods = sl.filter((l) => l.kind !== "tip");
      const tips = sl.filter((l) => l.kind === "tip");
      const goodsTotal = goods.reduce((s, l) => s + l.amountCents, 0);
      const taxableTotal = goods.filter((l) => l.taxable).reduce((s, l) => s + l.amountCents, 0);
      const sp = pays.filter((p) => p.saleId === sale.id);
      const paidTotal = sp.reduce((s, p) => s + p.amountCents, 0);
      // "Cash" on the sheet is money that did not go through a card (cash, other, a gift card, store credit, loyalty points); only a real card payment is "Credit Card"
      // and bears the card fee on tips.
      const cardPaid = sp.filter((p) => CARD_FEE_METHODS.has(p.method)).reduce((s, p) => s + p.amountCents, 0);
      const cashShare = paidTotal > 0 ? 1 - cardPaid / paidTotal : 0;
      const tipNoFeeShare = cashShare;
      const fullyRefunded = sale.status === "refunded" || (sale.paidCents > 0 && sale.refundedCents >= sale.paidCents);
      // Partial refunds reduce goods proportionally; tips are left whole.
      const keep = fullyRefunded || sale.paidCents <= 0 ? 1 : Math.max(0, (sale.paidCents - sale.refundedCents) / sale.paidCents);
      const checkoutBy = sale.createdByUserId ? (userName.get(sale.createdByUserId) ?? null) : null;
      const customer = sale.clientId ? (clientName.get(sale.clientId) ?? "Walk-in") : "Walk-in";
      const checkoutDate = localDate(sale.closedAt ?? sale.createdAt, tz);

      // Tips per staff, attached to that staff's first service line (or a standalone row).
      const tipByStaff = new Map<string, TipPart[]>();
      for (const t of tips) if (t.staffId) tipByStaff.set(t.staffId, [...(tipByStaff.get(t.staffId) ?? []), { amountCents: t.amountCents, method: t.tipMethod === "cash" || t.tipMethod === "card" ? t.tipMethod : null }]);

      const seenStaffTip = new Set<string>();
      for (const l of goods) {
        if (!l.staffId) continue;
        const disc = goodsTotal > 0 ? Math.round((sale.discountCents * l.amountCents) / goodsTotal) : 0;
        const tax = l.taxable && taxableTotal > 0 ? Math.round((sale.taxCents * l.amountCents) / taxableTotal) : 0;
        // A line covered by a package or membership credit carries its value in creditCents
        // (amountCents is 0 so the ticket adds up); the provider is still paid on it.
        const net = Math.round((l.amountCents - disc + tax) * keep) + Math.round((l.creditCents ?? 0) * keep);
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
        out.push({
          staffId: l.staffId,
          kind,
          refunded: fullyRefunded,
          date: start ? localDate(start, tz) : checkoutDate,
          customer,
          name: l.name + (fullyRefunded ? " (Refunded)" : ""),
          checkoutBy,
          saleNumber: sale.number,
          cashCents: cash,
          cardCents: card,
          cashTipCents: cashTip,
          cardTipCents: cardTip,
          discountCents: disc,
          amtPaidCents: net + tip,
          locationId: sale.locationId,
        });
      }
      // Tips for staff with no goods line on this sale (rare) → standalone row.
      for (const [staffId, parts] of tipByStaff) {
        if (seenStaffTip.has(staffId)) continue;
        const split = splitTips(parts, tipNoFeeShare);
        const tip = split.totalCents;
        out.push({ staffId, kind: "service", refunded: fullyRefunded, date: checkoutDate, customer, name: "Tip", checkoutBy, saleNumber: sale.number, cashCents: 0, cardCents: 0, cashTipCents: split.cashCents, cardTipCents: split.cardCents, discountCents: 0, amtPaidCents: tip, locationId: sale.locationId });
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
          .where(and(gte(schema.timeEntries.date, period.start), lte(schema.timeEntries.date, period.end))),
        tx
          .select()
          .from(schema.payrollAdjustments)
          .where(and(eq(schema.payrollAdjustments.periodStart, period.start), eq(schema.payrollAdjustments.periodEnd, period.end))),
      ]);
      // Pay settings as they stood at the end of the period, so an old period re-runs with its old rates.
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
    };
  });
  const hours: HoursEntry[] = rest.hours.filter((h) => !split || h.locationId === locationId).map((h) => ({ staffId: h.staffId, date: h.date, minutes: h.minutes }));
  const adjustments: Adjustment[] = split ? [] : rest.adjustments.map((a) => ({ staffId: a.staffId, label: a.label, amountCents: a.amountCents }));
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
  const result = computePayroll({ employees: inputs.employees, lines: inputs.lines, hours: inputs.hours, adjustments: inputs.adjustments, overtime, weekStart: 1 });
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
    });
    const sum = (k: keyof LocationPay) => result.employees.reduce((n, e) => n + e[k], 0);
    out.set(key, { mainCommissionCents: sum("mainCommissionCents"), productCommissionCents: sum("productCommissionCents"), wageCents: sum("wageCents"), totalCents: sum("totalCents"), serviceRevenueCents: sum("serviceRevenueCents") });
  }
  return out;
}

export async function getFinalizedRun(businessId: string, period: PayrollPeriod) {
  return withTenant(businessId, (tx) =>
    tx.query.payrollRuns.findFirst({ where: and(eq(schema.payrollRuns.periodStart, period.start), eq(schema.payrollRuns.periodEnd, period.end)) }),
  );
}

export async function finalizePayroll(business: Business, period: PayrollPeriod, overtime: boolean, actorUserId: string) {
  const result = await runPayroll(business, period, overtime);
  await withTenant(business.id, async (tx) => {
    await tx
      .insert(schema.payrollRuns)
      .values({ businessId: business.id, periodStart: period.start, periodEnd: period.end, overtime, snapshot: result as unknown as Record<string, unknown>, createdByUserId: actorUserId })
      .onConflictDoUpdate({
        target: [schema.payrollRuns.businessId, schema.payrollRuns.periodStart, schema.payrollRuns.periodEnd],
        set: { snapshot: result as unknown as Record<string, unknown>, overtime, createdByUserId: actorUserId, createdAt: new Date() },
      });
    await tx.insert(schema.auditLog).values({ businessId: business.id, actorUserId, action: "payroll.finalize", entity: "payroll_run", entityId: `${period.start}_${period.end}` });
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
