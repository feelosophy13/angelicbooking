import { and, asc, desc, eq, gte, inArray, lte, or, sql } from "drizzle-orm";
import { db, schema, withTenant, type TenantDb } from "@angelic/db";
import { CARD_FEE_METHODS, computePayroll, isScheduledPeriod, lineCommissionCents, periodContaining, rangesOverlap, salaryShare, weekStartOf, splitTips, zonedToInstant, type Adjustment, type HoursEntry, type OmittedLine, type PayrollEmployee, type PayrollLine, type PayrollResult, type PaySchedule, type TipPart } from "@angelic/core";
import { shiftISODate } from "@/lib/utils";
import { ratesForPeriod, syncCurrentRates } from "@/server/pay-rates";
import { PayrollLockedError } from "@/server/payroll-lock";

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
 * sale's payments refunded (goods only: a tip stays with the stylist unless the tip itself was refunded, itemized). So a refund after a
 * period was paid comes off the next period's pay instead of silently vanishing, and re-running a paid period gives the same numbers.
 *
 * Late tickets follow the same rule: a visit whose pay period was finalized before its ticket closed (or before the visit was moved
 * there by a reschedule) is paid in the period containing the close, as "Late ticket · <visit date>", never in the closed book.
 *
 * `omitted` is the Quality Check ledger: every line of a sale closed in the period that nobody is paid for here, and why.
 */
export async function buildPayrollLines(business: Business, period: PayrollPeriod, locationId?: string | null): Promise<PayrollLine[]> {
  return (await buildPayrollLinesDetailed(business, period, locationId)).lines;
}

export async function buildPayrollLinesDetailed(business: Business, period: PayrollPeriod, locationId?: string | null): Promise<{ lines: PayrollLine[]; omitted: OmittedLine[] }> {
  const tz = business.timezone;
  // Sales closed in the period (a day of slack each side; narrowed by local date below) plus, whenever they closed, sales with a visit
  // inside the period (a deposit taken months ahead, a ticket closed long after the visit): no look-ahead cap, so nothing is ever unpaid.
  const from = zonedToInstant(shiftISODate(period.start, -1), "00:00", tz);
  const to = zonedToInstant(shiftISODate(period.end, 2), "00:00", tz);
  const periodFrom = zonedToInstant(shiftISODate(period.start, -1), "00:00", tz);
  const periodTo = zonedToInstant(shiftISODate(period.end, 2), "00:00", tz);
  const refundFrom = from;
  const refundTo = to;
  return withTenant(business.id, async (tx) => {
    // Refunds that name their items claw back exactly those lines (itemEvents); the rest are spread over the ticket (refundEvents).
    const itemized = sql`exists (select 1 from refund_items ri where ri.refund_id = ${schema.refunds.id})`;
    const itemizedCredit = sql`exists (select 1 from refund_items ri where ri.credit_ledger_id = ${schema.storeCreditLedger.id})`;
    const [cardRefunds, creditRefunds, refundedItems, runs] = await Promise.all([
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
      // Every finalized period: a visit inside one that was finalized before its ticket closed is a late ticket (see bookVisit).
      tx.select({ periodStart: schema.payrollRuns.periodStart, periodEnd: schema.payrollRuns.periodEnd, createdAt: schema.payrollRuns.createdAt }).from(schema.payrollRuns),
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
    const visitInPeriod = sql`exists (select 1 from sale_lines sl join appointment_items ai on ai.id = sl.appointment_item_id where sl.sale_id = ${schema.sales.id} and ai.start_at >= ${periodFrom.toISOString()}::timestamptz and ai.start_at <= ${periodTo.toISOString()}::timestamptz)`;
    // A finalized book can't be opened, so late and moved tickets land in later periods: their sales must be loaded too, whenever they closed.
    const lateCandidates = runs.length ? [sql`(${schema.sales.closedAt} > ${new Date(Math.min(...runs.map((r) => r.createdAt.getTime()))).toISOString()}::timestamptz and exists (select 1 from sale_lines sl join appointment_items ai on ai.id = sl.appointment_item_id where sl.sale_id = ${schema.sales.id} and ai.start_at < ${periodFrom.toISOString()}::timestamptz))`] : [];
    const sales = await tx
      .select()
      .from(schema.sales)
      .where(
        and(
          sql`${schema.sales.status} in ('paid','refunded')`,
          ...(locationId ? [eq(schema.sales.locationId, locationId)] : []),
          or(and(gte(schema.sales.closedAt, from), lte(schema.sales.closedAt, to)), visitInPeriod, ...lateCandidates, ...(refundSaleIds.length ? [inArray(schema.sales.id, refundSaleIds)] : [])),
        ),
      );
    if (!sales.length) return { lines: [], omitted: [] };
    const saleIds = sales.map((s) => s.id);
    const [lines, pays] = await Promise.all([
      tx.select().from(schema.saleLines).where(sql`${schema.saleLines.saleId} in ${saleIds}`).orderBy(asc(schema.saleLines.sortOrder)),
      tx.select().from(schema.payments).where(and(sql`${schema.payments.saleId} in ${saleIds}`, sql`${schema.payments.status} in ('succeeded','partially_refunded','refunded')`)),
    ]);
    // Only the names, users and visit times these sales need (not every row in the business, or every user on the platform).
    const clientIds = [...new Set(sales.map((s) => s.clientId).filter((x): x is string => !!x))];
    const userIds = [...new Set(sales.map((s) => s.createdByUserId).filter((x): x is string => !!x))];
    const itemIds = [...new Set(lines.map((l) => l.appointmentItemId).filter((x): x is string => !!x))];
    const apptIds = [...new Set(sales.map((s) => s.appointmentId).filter((x): x is string => !!x))];
    const staffIds = [...new Set(lines.map((l) => l.staffId).filter((x): x is string => !!x))];
    const [clients, users, items, moves, staffRows, apptProviders] = await Promise.all([
      clientIds.length ? tx.select({ id: schema.clients.id, first: schema.clients.firstName, last: schema.clients.lastName }).from(schema.clients).where(inArray(schema.clients.id, clientIds)) : [],
      userIds.length ? tx.select({ id: schema.user.id, name: schema.user.name }).from(schema.user).where(inArray(schema.user.id, userIds)) : [],
      itemIds.length ? tx.select({ id: schema.appointmentItems.id, startAt: schema.appointmentItems.startAt }).from(schema.appointmentItems).where(inArray(schema.appointmentItems.id, itemIds)) : [],
      // Reschedules after a period was finalized: the visit's old day may already be paid, or its new day may be in a closed book.
      apptIds.length && runs.length
        ? tx.select({ apptId: schema.auditLog.entityId, at: schema.auditLog.at, diff: schema.auditLog.diff }).from(schema.auditLog).where(and(eq(schema.auditLog.action, "appointment.reschedule"), inArray(schema.auditLog.entityId, apptIds), gte(schema.auditLog.at, new Date(Math.min(...runs.map((r) => r.createdAt.getTime()))))))
        : [],
      staffIds.length ? tx.select({ id: schema.staff.id, name: schema.staff.displayName, active: schema.staff.active }).from(schema.staff).where(inArray(schema.staff.id, staffIds)) : [],
      // The appointment's provider (its first service's stylist), for the share of a no-show or late fee.
      apptIds.length && business.feeShareBps > 0 ? tx.select({ apptId: schema.appointmentItems.appointmentId, staffId: schema.appointmentItems.staffId, startAt: schema.appointmentItems.startAt }).from(schema.appointmentItems).where(inArray(schema.appointmentItems.appointmentId, apptIds)).orderBy(asc(schema.appointmentItems.startAt)) : [],
    ]);
    const providerOf = new Map<string, string>();
    for (const i of apptProviders) if (i.staffId && !providerOf.has(i.apptId)) providerOf.set(i.apptId, i.staffId);
    // Who absorbs a discount: the provider is paid on what was paid (default), the house pays as if full price, split is half each.
    const houseShare = business.discountAbsorb === "house" ? 1 : business.discountAbsorb === "split" ? 0.5 : 0;
    const clientName = new Map(clients.map((c) => [c.id, `${c.first} ${c.last}`.trim()]));
    const userName = new Map(users.map((u) => [u.id, u.name]));
    const itemStart = new Map(items.map((i) => [i.id, i.startAt]));
    const staffById = new Map(staffRows.map((x) => [x.id, x]));
    const lastMove = new Map<string, { at: Date; fromDate: string | null }>();
    for (const m of moves) {
      if (!m.apptId) continue;
      let fromDate: string | null = null;
      try {
        const d = JSON.parse(m.diff ?? "{}") as { from?: string };
        if (d.from) fromDate = localDate(new Date(d.from), tz);
      } catch {}
      const cur = lastMove.get(m.apptId);
      if (!cur || m.at > cur.at) lastMove.set(m.apptId, { at: m.at, fromDate: fromDate ?? cur?.fromDate ?? null });
    }
    const finalizedOn = (date: string, before: Date) => runs.find((r) => r.periodStart <= date && date <= r.periodEnd && r.createdAt < before);
    /**
     * The day a visit is paid on. Its own day, unless that day's period was finalized before the ticket closed (or before the visit was
     * moved there): then the day it closed or was moved, pushed past any period that was also finalized before then.
     */
    const bookVisit = (visitDate: string, settledAt: Date): { date: string; late: boolean } => {
      if (!finalizedOn(visitDate, settledAt)) return { date: visitDate, late: false };
      let d = localDate(settledAt, tz);
      for (let guard = 0; guard < 60; guard++) {
        const r = finalizedOn(d, settledAt);
        if (!r) break;
        d = shiftISODate(r.periodEnd, 1);
      }
      return { date: d, late: true };
    };

    const out: PayrollLine[] = [];
    const omitted: OmittedLine[] = [];
    for (const sale of sales) {
      const sl = lines.filter((l) => l.saleId === sale.id);
      const goods = sl.filter((l) => l.kind !== "tip");
      const checkoutDay = localDate(sale.closedAt ?? sale.createdAt, tz);
      const closedInPeriod = inPeriod(checkoutDay);
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
      const checkoutDate = checkoutDay;
      const move = sale.appointmentId ? lastMove.get(sale.appointmentId) : undefined;
      // A ticket is settled when it closed, or when its visit was last moved if that came later (a reschedule into or out of a closed book).
      const settledAt = move && sale.closedAt && move.at > sale.closedAt ? move.at : (sale.closedAt ?? sale.createdAt);
      const staffName = (id: string | null) => (id ? (staffById.get(id)?.name ?? null) : null);
      const omit = (l: (typeof sl)[number], reason: OmittedLine["reason"], detail?: string, date = checkoutDate) => {
        if (closedInPeriod || inPeriod(date)) omitted.push({ date, saleNumber: sale.number, customer, name: l.name, kind: l.kind, staffName: staffName(l.staffId), amountCents: l.amountCents + (l.creditCents ?? 0), reason, detail });
      };

      // Tips per staff, attached to that staff's first service line (or a standalone row).
      const tipByStaff = new Map<string, TipPart[]>();
      for (const t of tips) {
        if (!t.staffId) {
          omit(t, "no staff credited", "tip with no stylist on it");
          continue;
        }
        tipByStaff.set(t.staffId, [...(tipByStaff.get(t.staffId) ?? []), { amountCents: t.amountCents, method: t.tipMethod === "cash" || t.tipMethod === "card" ? t.tipMethod : null }]);
      }

      const base: PayrollLine[] = [];
      const baseByLine = new Map<string, PayrollLine>();
      const seenStaffTip = new Set<string>();
      for (const l of goods) {
        const start = l.appointmentItemId ? itemStart.get(l.appointmentItemId) : null;
        const visitDate = start ? localDate(start, tz) : null;
        // A no-show or late-cancellation fee has no stylist on it; with a fee share set, the appointment's provider is credited their part.
        const feeProvider = l.kind === "fee" && !l.staffId && sale.appointmentId ? (providerOf.get(sale.appointmentId) ?? null) : null;
        if (l.kind === "fee" && feeProvider && business.feeShareBps > 0 && l.amountCents > 0) {
          const share = Math.round((l.amountCents * business.feeShareBps) / 10_000);
          const cash = Math.round(share * cashShare);
          const booked = visitDate ? bookVisit(visitDate, settledAt) : { date: checkoutDate, late: false };
          base.push({ staffId: feeProvider, kind: "fee", refunded: false, date: booked.date, customer, name: `${l.name} · ${business.feeShareBps / 100}% share`, checkoutBy, saleNumber: sale.number, cashCents: cash, cardCents: share - cash, cashTipCents: 0, cardTipCents: 0, discountCents: 0, amtPaidCents: share, locationId: sale.locationId });
          continue;
        }
        if (!l.staffId) {
          if (l.kind === "service" || l.kind === "product" || l.kind === "package") omit(l, "no staff credited", undefined, visitDate ?? checkoutDate);
          else omit(l, "not commissionable", l.kind === "gift_card" ? "gift card" : l.kind === "fee" ? `no-show or late-cancellation fee${sale.appointmentId ? "" : ", no appointment"}${business.feeShareBps > 0 ? ", no provider on the appointment" : " (no fee share set)"}` : l.kind, visitDate ?? checkoutDate);
          continue;
        }
        // A visit moved out of a period that was finalized while it was still there was paid in that period's snapshot: not again here.
        if (move && visitDate && move.fromDate && move.fromDate !== visitDate && sale.closedAt && sale.closedAt < move.at) {
          const paidIn = finalizedOn(move.fromDate, move.at);
          if (paidIn && sale.closedAt < paidIn.createdAt) {
            omit(l, "paid in an earlier period", `paid as a ${move.fromDate} visit in ${paidIn.periodStart} – ${paidIn.periodEnd}, moved to ${visitDate} after that period was finalized`, visitDate);
            continue;
          }
        }
        const ticketDisc = goodsTotal > 0 ? Math.round((sale.discountCents * l.amountCents) / goodsTotal) : 0;
        // A member's "% off services" is baked into the unit price; it is a discount all the same, so it shows in the Disc column and
        // follows the same "who absorbs it" rule.
        const memberDisc = l.preMemberUnitCents != null && l.preMemberUnitCents > l.unitCents ? (l.preMemberUnitCents - l.unitCents) * l.quantity : 0;
        const disc = ticketDisc + memberDisc;
        const houseDiscount = Math.round(disc * houseShare);
        const tax = l.taxable && taxableTotal > 0 ? Math.round((sale.taxCents * l.amountCents) / taxableTotal) : 0;
        // A line covered by a package or membership credit carries its value in creditCents
        // (amountCents is 0 so the ticket adds up); the provider is still paid on it.
        const net = l.amountCents - ticketDisc + tax + (l.creditCents ?? 0);
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
        const booked = visitDate ? bookVisit(visitDate, settledAt) : { date: checkoutDate, late: false };
        const row: PayrollLine = {
          staffId: l.staffId,
          kind,
          refunded: false,
          date: booked.date,
          customer,
          name: booked.late ? `Late ticket · ${visitDate} · ${l.name}` : l.name,
          checkoutBy,
          saleNumber: sale.number,
          cashCents: cash,
          cardCents: card,
          cashTipCents: cashTip,
          cardTipCents: cardTip,
          discountCents: disc,
          amtPaidCents: net + tip,
          locationId: sale.locationId,
          saleLineId: l.id,
          ...(houseDiscount ? { houseDiscountCents: houseDiscount } : {}),
        };
        if (kind === "fee") omit(l, "not commissionable", "fee line with a stylist on it: fees are not commissionable", booked.date);
        if (closedInPeriod && !inPeriod(booked.date)) omit(l, "out of period", `closed ${checkoutDate}, paid as a ${booked.date} visit`, booked.date);
        if (staffById.get(l.staffId)?.active === false) omit(l, "inactive staff", "still paid; the person is off the roster", booked.date);
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
        if (!t.staffId) {
          omit(t, "no staff credited", "tip added later with no stylist on it", localDate(t.createdAt, tz));
          continue;
        }
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
      // Each refund of this sale in the period takes back its share of the goods on every row, on the day it was refunded. Tips stay with
      // the stylist: a whole-ticket refund is the salon giving the client's money back, not the stylist's, unless the tip itself is refunded
      // (an itemized refund naming the tip line, above).
      const goodsPaid = paidTotal - sl.filter((l) => l.kind === "tip").reduce((s, l) => s + l.amountCents, 0);
      if (goodsPaid > 0) {
        for (const r of refundEvents.filter((e) => e.saleId === sale.id)) {
          const f = Math.min(1, r.cents / goodsPaid);
          const back = (c: number) => -Math.round(c * f);
          for (const b of base) {
            const goodsOnRow = b.amtPaidCents - b.cashTipCents - b.cardTipCents;
            if (goodsOnRow === 0) continue;
            out.push({ ...b, date: r.date, name: `Refund · ${b.name}`, cashCents: back(b.cashCents), cardCents: back(b.cardCents), cashTipCents: 0, cardTipCents: 0, discountCents: 0, amtPaidCents: back(goodsOnRow) });
          }
        }
      }
    }
    return { lines: out.filter((l) => l.date >= period.start && l.date <= period.end), omitted };
  });
}

/**
 * `split` (with a `locationId`) apportions the pay that is not tied to a sale to that site, for
 * reports: hours are those clocked there, salary goes to people whose primary location it is, and
 * per-person adjustments are left out. Without it a location filter narrows sales only, so a pay
 * sheet still shows each person's whole pay.
 */
export async function getPayrollInputs(business: Business, period: PayrollPeriod, locationId?: string | null, opts: { split?: boolean } = {}) {
  const [{ lines, omitted }, rest] = await Promise.all([
    buildPayrollLinesDetailed(business, period, locationId),
    withTenant(business.id, async (tx) => {
      // Scheduled changes whose date has arrived land on the staff record here, so lists stay current.
      await syncCurrentRates(tx, localDate(new Date(), business.timezone));
      const [staff, hours, adjustments] = await Promise.all([
        tx.select().from(schema.staff).orderBy(asc(schema.staff.displayName)),
        tx
          .select({ staffId: schema.timeEntries.staffId, date: schema.timeEntries.date, minutes: schema.timeEntries.minutes, locationId: schema.timeEntries.locationId })
          .from(schema.timeEntries)
          // From the start of the first workweek (the business's week start), so overtime counts the week's earlier days (they aren't paid twice: see countFrom).
          .where(and(gte(schema.timeEntries.date, weekStartOf(period.start, business.weekStart)), lte(schema.timeEntries.date, period.end))),
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
      locationId: s.locationId ?? null,
      inactive: !s.active,
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
    omitted,
    hours,
    adjustments,
    adjustmentRows: split ? [] : rest.adjustments,
    rateChanges,
    /** Every time entry with its site, and each person's primary site, for reporting by location. */
    hoursRaw: rest.hours,
    primaryLocation: new Map(rest.staff.map((s) => [s.id, s.locationId ?? null] as const)),
  };
}

/**
 * The business's pay schedule. One set under Payroll → Options is `configured`; without one the page assumes every two weeks from the
 * most recent finalized period (else the week start on or before today), and salary stays a flat amount per run (nothing is prorated).
 */
export async function resolveSchedule(business: Business, today: string): Promise<{ schedule: PaySchedule; configured: boolean }> {
  if (business.payFrequency) return { schedule: { frequency: business.payFrequency, anchor: business.payAnchorDate }, configured: true };
  const [latest] = await withTenant(business.id, (tx) => tx.select({ start: schema.payrollRuns.periodStart }).from(schema.payrollRuns).orderBy(desc(schema.payrollRuns.periodStart)).limit(1));
  return { schedule: { frequency: "biweekly", anchor: latest?.start ?? weekStartOf(today, business.weekStart) }, configured: false };
}

/** The scheduled period containing today: what the Payroll page and the export open on. */
export async function currentPeriod(business: Business, today: string): Promise<PayrollPeriod> {
  const { schedule } = await resolveSchedule(business, today);
  return periodContaining(schedule, today);
}

/**
 * Salary for a run: a salary is "per scheduled pay period", so a run that is not exactly one period (a custom range) pays it pro rata by
 * the days of each scheduled period it covers. Without a configured schedule the share is 1 (flat per run, as before).
 */
export async function salaryShareFor(business: Business, period: PayrollPeriod, today: string): Promise<{ share: number; prorated: boolean; pieces: ReturnType<typeof salaryShare>["pieces"] }> {
  const { schedule, configured } = await resolveSchedule(business, today);
  if (!configured || isScheduledPeriod(schedule, period)) return { share: 1, prorated: false, pieces: [] };
  const r = salaryShare(schedule, period);
  return { share: r.share, prorated: true, pieces: r.pieces };
}

export type PayrollRun = PayrollResult & { adjustmentRows: (typeof schema.payrollAdjustments.$inferSelect)[]; rateChanges: { staffId: string; name: string; effectiveFrom: string }[]; salaryShare: number; omitted: OmittedLine[] };

/** `locationId` limits sales (commission, tips) to one site; hours and adjustments are per person and stay whole. */
export async function runPayroll(business: Business, period: PayrollPeriod, overtime: boolean, locationId?: string | null, opts: { split?: boolean } = {}): Promise<PayrollRun> {
  const [inputs, salary] = await Promise.all([getPayrollInputs(business, period, locationId, opts), salaryShareFor(business, period, localDate(new Date(), business.timezone))]);
  const result = computePayroll({ employees: inputs.employees, lines: inputs.lines, hours: inputs.hours, adjustments: inputs.adjustments, overtime, overtimeRule: business.overtimeRule, weekStart: business.weekStart, countFrom: period.start, salaryShare: salary.share });
  return { ...result, adjustmentRows: inputs.adjustmentRows, rateChanges: inputs.rateChanges, salaryShare: salary.share, omitted: inputs.omitted };
}

/** A finalized period's figures, as saved: the snapshot is the whole run. Fields older snapshots lack are filled from the live run. */
export function runFromSnapshot(snapshot: unknown, live: PayrollRun): PayrollRun {
  const snap = snapshot as Partial<PayrollRun>;
  const home = new Map(live.employees.map((e) => [e.employee.staffId, e.employee] as const));
  const employees = (snap.employees ?? []).map((e) => {
    const l = home.get(e.employee.staffId);
    return { ...e, employee: { ...e.employee, locationId: e.employee.locationId === undefined ? (l?.locationId ?? null) : e.employee.locationId, inactive: e.employee.inactive ?? l?.inactive ?? false } };
  });
  return { employees, unmatchedStaffIds: snap.unmatchedStaffIds ?? [], adjustmentRows: snap.adjustmentRows ?? live.adjustmentRows, rateChanges: snap.rateChanges ?? [], salaryShare: snap.salaryShare ?? 1, omitted: snap.omitted ?? [] };
}

/**
 * What the Payroll page and the exports show for a period: the saved snapshot when the period is finalized (finalized means finalized), else
 * the live run. The live run comes back as well, for "what changed since". A finalized period keeps the overtime setting it was finalized with.
 */
export async function payrollForPeriod(business: Business, period: PayrollPeriod, overtime: boolean) {
  const finalized = await getFinalizedRun(business.id, period);
  const live = await runPayroll(business, period, finalized ? finalized.overtime : overtime);
  const result = finalized ? runFromSnapshot(finalized.snapshot, live) : live;
  return { result, live, finalized, overtime: finalized ? finalized.overtime : overtime };
}

/** The people based at one location (staff.locationId), with all of their pay: the owner runs one pay sheet per site, the employee's site deciding. */
export function forHomeLocation(run: PayrollRun, locationId: string | null): PayrollRun {
  if (!locationId) return run;
  const employees = run.employees.filter((e) => (e.employee.locationId ?? null) === locationId);
  const ids = new Set(employees.map((e) => e.employee.staffId));
  return { ...run, employees, adjustmentRows: run.adjustmentRows.filter((a) => ids.has(a.staffId)), rateChanges: run.rateChanges.filter((c) => ids.has(c.staffId)), omitted: run.omitted };
}

/** One person's own row (the "See their own pay sheet" permission). */
export function forOwnRow(run: PayrollRun, staffId: string | null): PayrollRun {
  return { ...run, employees: run.employees.filter((e) => e.employee.staffId === staffId), adjustmentRows: run.adjustmentRows.filter((a) => a.staffId === staffId), rateChanges: run.rateChanges.filter((c) => c.staffId === staffId), omitted: [] };
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
      weekStart: business.weekStart,
      countFrom: period.start,
    });
    const sum = (k: keyof LocationPay) => result.employees.reduce((n, e) => n + e[k], 0);
    out.set(key, { mainCommissionCents: sum("mainCommissionCents"), productCommissionCents: sum("productCommissionCents"), wageCents: sum("wageCents"), totalCents: sum("totalCents"), serviceRevenueCents: sum("serviceRevenueCents") });
  }
  return out;
}

/**
 * Service commission by the performed service's category for reports: what Payroll credits providers on the service lines it pays in the
 * period (visit-dated, at that day's rates, with the house's share of discounts and a package or membership session's value in the base),
 * less the clawbacks of refunds made in the period. Key `null` is "no category". Hourly and salary pay is not tied to a line, so it is not here.
 */
export async function payByCategory(business: Business, period: PayrollPeriod, locationId?: string | null): Promise<Map<string | null, number>> {
  const inputs = await getPayrollInputs(business, period, locationId);
  const emp = new Map(inputs.employees.map((e) => [e.staffId, e]));
  const byLine = new Map<string, number>();
  for (const l of inputs.lines) {
    const e = emp.get(l.staffId);
    if (!e || l.kind !== "service" || !l.saleLineId) continue;
    byLine.set(l.saleLineId, (byLine.get(l.saleLineId) ?? 0) + lineCommissionCents(e, l));
  }
  const out = new Map<string | null, number>();
  if (!byLine.size) return out;
  const rows = await withTenant(business.id, (tx) =>
    tx
      .select({ id: schema.saleLines.id, categoryId: schema.services.categoryId })
      .from(schema.saleLines)
      .leftJoin(schema.services, eq(schema.services.id, schema.saleLines.serviceId))
      .where(inArray(schema.saleLines.id, [...byLine.keys()])),
  );
  const category = new Map(rows.map((r) => [r.id, r.categoryId ?? null]));
  for (const [id, cents] of byLine) {
    const key = category.get(id) ?? null;
    out.set(key, (out.get(key) ?? 0) + cents);
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

/** A finalized period that shares a day with `period` but is not `period` itself: two of those would pay the same days twice. */
export async function overlappingFinalizedRun(tx: TenantDb, period: PayrollPeriod) {
  const runs = await tx.select({ periodStart: schema.payrollRuns.periodStart, periodEnd: schema.payrollRuns.periodEnd }).from(schema.payrollRuns).where(and(lte(schema.payrollRuns.periodStart, period.end), gte(schema.payrollRuns.periodEnd, period.start)));
  return runs.find((r) => !(r.periodStart === period.start && r.periodEnd === period.end) && rangesOverlap({ start: r.periodStart, end: r.periodEnd }, period)) ?? null;
}

export async function finalizePayroll(business: Business, period: PayrollPeriod, overtime: boolean, actorUserId: string) {
  const clash = await withTenant(business.id, (tx) => overlappingFinalizedRun(tx, period));
  if (clash) throw new PayrollLockedError(`This period overlaps ${clash.periodStart} to ${clash.periodEnd}, which is already finalized. Pick a period that starts after ${clash.periodEnd} (or ends before ${clash.periodStart}).`);
  const previous = await getFinalizedRun(business.id, period);
  // Checks that went out are the record; the figures behind them can't be swapped underneath. Unmark first, deliberately.
  if (previous?.paidOn) throw new PayrollLockedError(`This period was marked paid on ${previous.paidOn}${previous.paymentRef ? ` (${previous.paymentRef})` : ""}. Unmark it before re-finalizing.`);
  const result = await runPayroll(business, period, overtime);
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

/** Record that a finalized period's checks went out: the day and a check number or batch reference. Audited; locks re-finalize until unmarked. */
export async function markPayrollPaid(business: Business, period: PayrollPeriod, input: { paidOn: string; paymentRef: string | null }, actorUserId: string) {
  await withTenant(business.id, async (tx) => {
    const run = await getFinalizedRunIn(tx, period);
    if (!run) throw new PayrollLockedError("Finalize the period before marking it paid.");
    await tx.update(schema.payrollRuns).set({ paidOn: input.paidOn, paymentRef: input.paymentRef, paidByUserId: actorUserId, paidAt: new Date() }).where(eq(schema.payrollRuns.id, run.id));
    await tx.insert(schema.auditLog).values({ businessId: business.id, actorUserId, action: "payroll.mark_paid", entity: "payroll_run", entityId: `${period.start}_${period.end}`, diff: JSON.stringify({ paidOn: input.paidOn, paymentRef: input.paymentRef, previous: run.paidOn ? { paidOn: run.paidOn, paymentRef: run.paymentRef } : null }) });
  });
}

export async function unmarkPayrollPaid(business: Business, period: PayrollPeriod, actorUserId: string) {
  await withTenant(business.id, async (tx) => {
    const run = await getFinalizedRunIn(tx, period);
    if (!run?.paidOn) return;
    await tx.update(schema.payrollRuns).set({ paidOn: null, paymentRef: null, paidByUserId: null, paidAt: null }).where(eq(schema.payrollRuns.id, run.id));
    await tx.insert(schema.auditLog).values({ businessId: business.id, actorUserId, action: "payroll.unmark_paid", entity: "payroll_run", entityId: `${period.start}_${period.end}`, diff: JSON.stringify({ was: { paidOn: run.paidOn, paymentRef: run.paymentRef } }) });
  });
}

export async function listPayrollRuns(businessId: string) {
  return withTenant(businessId, (tx) =>
    tx
      .select({ id: schema.payrollRuns.id, periodStart: schema.payrollRuns.periodStart, periodEnd: schema.payrollRuns.periodEnd, createdAt: schema.payrollRuns.createdAt, overtime: schema.payrollRuns.overtime, paidOn: schema.payrollRuns.paidOn, paymentRef: schema.payrollRuns.paymentRef })
      .from(schema.payrollRuns)
      .orderBy(sql`${schema.payrollRuns.periodStart} desc`)
      .limit(24),
  );
}


