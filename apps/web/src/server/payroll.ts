import { and, asc, eq, gte, lte, sql } from "drizzle-orm";
import { db, schema, withTenant } from "@angelic/db";
import { computePayroll, zonedToInstant, type Adjustment, type HoursEntry, type PayrollEmployee, type PayrollLine, type PayrollResult } from "@angelic/core";
import { shiftISODate } from "@/lib/utils";

export interface PayrollPeriod {
  start: string; // YYYY-MM-DD inclusive
  end: string; // inclusive
}

type Business = typeof schema.businesses.$inferSelect;

const CASH_METHODS = new Set(["cash", "other"]);

function localDate(at: Date, tz: string) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(at);
}

/**
 * Build payable lines for a period from closed sales. A service line is
 * credited to the date the appointment happened (so deposits taken earlier
 * land in the right period); products and other lines to the checkout date.
 * Discounts, tax and tips are allocated per line so the sheet's columns add up.
 */
export async function buildPayrollLines(business: Business, period: PayrollPeriod): Promise<PayrollLine[]> {
  const tz = business.timezone;
  // Pull a wide window of closed sales (6 months back) because appointment dates
  // can precede or follow checkout; narrow by credited date below.
  const from = zonedToInstant(shiftISODate(period.start, -183), "00:00", tz);
  const to = zonedToInstant(shiftISODate(period.end, 31), "00:00", tz);
  return withTenant(business.id, async (tx) => {
    const sales = await tx
      .select()
      .from(schema.sales)
      .where(and(gte(schema.sales.closedAt, from), lte(schema.sales.closedAt, to), sql`${schema.sales.status} in ('paid','refunded')`));
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
      const cashPaid = sp.filter((p) => CASH_METHODS.has(p.method)).reduce((s, p) => s + p.amountCents, 0);
      const cashShare = paidTotal > 0 ? cashPaid / paidTotal : 0;
      const fullyRefunded = sale.status === "refunded" || (sale.paidCents > 0 && sale.refundedCents >= sale.paidCents);
      // Partial refunds reduce goods proportionally; tips are left whole.
      const keep = fullyRefunded || sale.paidCents <= 0 ? 1 : Math.max(0, (sale.paidCents - sale.refundedCents) / sale.paidCents);
      const checkoutBy = sale.createdByUserId ? (userName.get(sale.createdByUserId) ?? null) : null;
      const customer = sale.clientId ? (clientName.get(sale.clientId) ?? "Walk-in") : "Walk-in";
      const checkoutDate = localDate(sale.closedAt ?? sale.createdAt, tz);

      // Tips per staff, attached to that staff's first service line (or a standalone row).
      const tipByStaff = new Map<string, number>();
      for (const t of tips) if (t.staffId) tipByStaff.set(t.staffId, (tipByStaff.get(t.staffId) ?? 0) + t.amountCents);

      const seenStaffTip = new Set<string>();
      for (const l of goods) {
        if (!l.staffId) continue;
        const disc = goodsTotal > 0 ? Math.round((sale.discountCents * l.amountCents) / goodsTotal) : 0;
        const tax = l.taxable && taxableTotal > 0 ? Math.round((sale.taxCents * l.amountCents) / taxableTotal) : 0;
        const net = Math.round((l.amountCents - disc + tax) * keep);
        let tip = 0;
        if (l.kind === "service" && !seenStaffTip.has(l.staffId) && tipByStaff.has(l.staffId)) {
          tip = tipByStaff.get(l.staffId)!;
          seenStaffTip.add(l.staffId);
        }
        const cashTip = Math.round(tip * cashShare);
        const cardTip = tip - cashTip;
        const cash = Math.round(net * cashShare);
        const card = net - cash;
        const kind: PayrollLine["kind"] = l.kind === "service" ? "service" : l.kind === "product" ? (/package/i.test(l.name) ? "package" : /membership/i.test(l.name) ? "membership" : "product") : "fee";
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
        });
      }
      // Tips for staff with no goods line on this sale (rare) → standalone row.
      for (const [staffId, tip] of tipByStaff) {
        if (seenStaffTip.has(staffId)) continue;
        const cashTip = Math.round(tip * cashShare);
        out.push({ staffId, kind: "service", refunded: fullyRefunded, date: checkoutDate, customer, name: "Tip", checkoutBy, saleNumber: sale.number, cashCents: 0, cardCents: 0, cashTipCents: cashTip, cardTipCents: tip - cashTip, discountCents: 0, amtPaidCents: tip });
      }
    }
    return out.filter((l) => l.date >= period.start && l.date <= period.end);
  });
}

export async function getPayrollInputs(business: Business, period: PayrollPeriod) {
  const [lines, rest] = await Promise.all([
    buildPayrollLines(business, period),
    withTenant(business.id, async (tx) => {
      const [staff, hours, adjustments] = await Promise.all([
        tx.select().from(schema.staff).orderBy(asc(schema.staff.displayName)),
        tx
          .select({ staffId: schema.timeEntries.staffId, date: schema.timeEntries.date, minutes: schema.timeEntries.minutes })
          .from(schema.timeEntries)
          .where(and(gte(schema.timeEntries.date, period.start), lte(schema.timeEntries.date, period.end))),
        tx
          .select()
          .from(schema.payrollAdjustments)
          .where(and(eq(schema.payrollAdjustments.periodStart, period.start), eq(schema.payrollAdjustments.periodEnd, period.end))),
      ]);
      return { staff, hours, adjustments };
    }),
  ]);
  const employees: PayrollEmployee[] = rest.staff.map((s) => ({
    staffId: s.id,
    name: s.displayName,
    position: s.position,
    payType: s.payType,
    mainCommissionBps: s.mainCommissionBps,
    productCommissionBps: s.productCommissionBps,
    ccTipFeeBps: s.ccTipFeeBps,
    hourlyRateCents: s.hourlyRateCents,
    salaryPerPeriodCents: s.salaryPerPeriodCents,
    overtimeOverride: s.overtimeOverride,
    taxDeductionCents: s.taxDeductionCents,
    taxDeductionBps: s.taxDeductionBps,
  }));
  const hours: HoursEntry[] = rest.hours.map((h) => ({ staffId: h.staffId, date: h.date, minutes: h.minutes }));
  const adjustments: Adjustment[] = rest.adjustments.map((a) => ({ staffId: a.staffId, label: a.label, amountCents: a.amountCents }));
  return { employees, lines, hours, adjustments, adjustmentRows: rest.adjustments };
}

export async function runPayroll(business: Business, period: PayrollPeriod, overtime: boolean): Promise<PayrollResult & { adjustmentRows: (typeof schema.payrollAdjustments.$inferSelect)[] }> {
  const inputs = await getPayrollInputs(business, period);
  const result = computePayroll({ ...inputs, overtime, weekStart: 1 });
  return { ...result, adjustmentRows: inputs.adjustmentRows };
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
