import { allocateProportionally } from "./pricing";
/**
 * Pure payroll math, reproducing the salon's existing pay sheets to the cent.
 *
 * Pay is built from components that can be combined on one person:
 *   - service commission: mainCommissionBps on main-service revenue (amt paid − tips, net of discount)
 *   - product/package commission: productCommissionBps on misc sales (memberships earn 0)
 *   - hourly wage: hourlyRateCents × clocked hours (+ overtime when enabled)
 *   - salary: salaryPerPeriodCents flat per run
 *   - tips (cash + card) − a fee on card tips, plus adjustments
 * `payType` decides the sheet: "commission" is a 1099 contractor (no withholding; an hourly
 * rate on top is a guaranteed base), "hourly" / "salary" are W-2 employees (withholding applies;
 * a commission % on top pays them on the services they perform).
 * All money is integer cents; percentages are basis points (4000 = 40%).
 */

export type PayType = "commission" | "hourly" | "salary";

export interface PayrollEmployee {
  staffId: string;
  name: string;
  position: string | null;
  payType: PayType;
  mainCommissionBps: number;
  productCommissionBps: number;
  ccTipFeeBps: number;
  hourlyRateCents: number;
  salaryPerPeriodCents: number;
  overtimeOverride: boolean | null;
  taxDeductionCents: number | null;
  taxDeductionBps: number | null;
}

export type LineKind = "service" | "product" | "package" | "membership" | "fee";

export interface PayrollLine {
  staffId: string;
  kind: LineKind;
  refunded: boolean;
  /** Local ISO date the line is credited to (appointment date for services, checkout date otherwise). */
  date: string;
  customer: string;
  name: string;
  checkoutBy: string | null;
  saleNumber: number | null;
  cashCents: number;
  cardCents: number;
  cashTipCents: number;
  cardTipCents: number;
  discountCents: number;
  /** Amount paid for this line including its tips. */
  amtPaidCents: number;
  /** The sale's location, so pay can be reported by site. */
  locationId?: string | null;
}

export interface HoursEntry {
  staffId: string;
  date: string; // YYYY-MM-DD
  minutes: number;
}

export interface Adjustment {
  staffId: string;
  label: string;
  amountCents: number;
}

export interface PayrollInput {
  employees: PayrollEmployee[];
  lines: PayrollLine[];
  hours: HoursEntry[];
  adjustments: Adjustment[];
  /** Run-level overtime (1.5× over 40h per workweek). Employees can override. */
  overtime: boolean;
  /** 0 = Sunday … 6 = Saturday. Default Monday. */
  weekStart?: number;
}

export interface WeekHours {
  weekStart: string;
  minutes: number;
  regularMinutes: number;
  overtimeMinutes: number;
}

export interface EmployeePayroll {
  employee: PayrollEmployee;
  mainRows: PayrollLine[];
  miscRows: PayrollLine[];
  refundedRows: PayrollLine[];
  hoursByDate: { date: string; minutes: number }[];
  weeks: WeekHours[];
  totalMinutes: number;
  regularMinutes: number;
  overtimeMinutes: number;
  overtimeApplied: boolean;
  wageCents: number; // hourly or salary pay before adjustments
  mainRevenueCents: number; // service money on main rows (amt paid − tips)
  mainCommissionCents: number;
  productSalesCents: number; // commissionable misc (products + packages)
  productCommissionCents: number;
  cashTipsCents: number;
  cardTipsCents: number;
  ccTipFeeCents: number;
  adjustments: Adjustment[];
  adjustmentsCents: number;
  taxCents: number;
  /** Commission: Total 1099. Hourly/salary: Total Check (pre-withholding unless tax configured). */
  totalCents: number;
  serviceRevenueCents: number;
  serviceProfitCents: number;
  hasActivity: boolean;
}

export interface PayrollResult {
  employees: EmployeePayroll[];
  unmatchedStaffIds: string[];
}

/** A tip on a sale and how it was handed over, when the desk said: "cash" or "card"; null means "same as the payment". */
export interface TipPart {
  amountCents: number;
  method: "cash" | "card" | null;
}

/** Payment methods that cost the salon a card-processing fee. Cash, "other", gift cards, store credit and loyalty points do not. */
export const CARD_FEE_METHODS = new Set(["card", "card_on_file", "terminal"]);

/**
 * Cash versus card for one person's tips on one sale. A tip the desk marked cash or card goes where it was marked;
 * the rest (older tips, or "same as the payment") follows `noFeeShare`, the share of what the sale was paid with
 * that carried no card fee (0 = all by card, 1 = all cash/other). Parts add back to the total exactly.
 */
export function splitTips(parts: TipPart[], noFeeShare: number): { cashCents: number; cardCents: number; totalCents: number } {
  let cash = 0;
  let unspecified = 0;
  let total = 0;
  for (const p of parts) {
    if (p.amountCents <= 0) continue;
    total += p.amountCents;
    if (p.method === "cash") cash += p.amountCents;
    else if (p.method === "card") continue;
    else unspecified += p.amountCents;
  }
  const share = Math.min(1, Math.max(0, noFeeShare));
  cash += Math.round(unspecified * share);
  return { cashCents: cash, cardCents: total - cash, totalCents: total };
}

/**
 * How a sale's tips land on its payments, for reports and the API. A tip marked cash goes to the payments that were not by card (cash, other,
 * gift card, store credit, points), a tip marked card to the card payments, and an unmarked one across every payment; each is shared in proportion to the
 * payment amounts. When there is nothing of the right kind (a "card" tip on a cash-only sale) it falls back to all payments. Whole cents, adding back exactly.
 */
export function tipsPerPayment(parts: TipPart[], pays: { id: string; method: string; amountCents: number }[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const p of pays) out[p.id] = 0;
  if (!pays.length) return out;
  const card = pays.filter((p) => CARD_FEE_METHODS.has(p.method));
  const noFee = pays.filter((p) => !CARD_FEE_METHODS.has(p.method));
  const spread = (cents: number, group: typeof pays) => {
    const g = group.length ? group : pays;
    const shares = allocateProportionally(cents, g.map((p) => ({ key: p.id, weight: p.amountCents })));
    for (const [id, v] of Object.entries(shares)) out[id] = (out[id] ?? 0) + v;
  };
  for (const part of parts) {
    if (part.amountCents <= 0) continue;
    spread(part.amountCents, part.method === "cash" ? noFee : part.method === "card" ? card : pays);
  }
  return out;
}

export const NON_REVENUE_POSITIONS = ["receptionist", "manager", "front desk", "admin"];

export function generatesRevenue(position: string | null | undefined): boolean {
  const p = (position ?? "").toLowerCase();
  return !NON_REVENUE_POSITIONS.some((k) => p.includes(k));
}

/** Round half away from zero, like the salon's spreadsheets. */
export function roundCents(x: number): number {
  return Math.sign(x) * Math.round(Math.abs(x));
}

const bps = (cents: number, b: number) => roundCents((cents * b) / 10_000);

export function isMiscKind(kind: LineKind): boolean {
  return kind !== "service";
}

/** Detect memberships by name when the kind is unknown (mirrors the salon's rule). */
export function looksLikeMembership(name: string): boolean {
  return /membership/i.test(name);
}

function weekStartOf(date: string, weekStart: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const dt = new Date(Date.UTC(y!, m! - 1, d!));
  const diff = (dt.getUTCDay() - weekStart + 7) % 7;
  dt.setUTCDate(dt.getUTCDate() - diff);
  return dt.toISOString().slice(0, 10);
}

export function computeHours(entries: HoursEntry[], weekStart: number, applyOvertime: boolean, thresholdMinutes = 40 * 60): {
  byDate: { date: string; minutes: number }[];
  weeks: WeekHours[];
  totalMinutes: number;
  regularMinutes: number;
  overtimeMinutes: number;
} {
  const byDateMap = new Map<string, number>();
  for (const e of entries) byDateMap.set(e.date, (byDateMap.get(e.date) ?? 0) + Math.max(0, e.minutes));
  const byDate = [...byDateMap.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, minutes]) => ({ date, minutes }));
  const weekMap = new Map<string, number>();
  for (const { date, minutes } of byDate) {
    const w = weekStartOf(date, weekStart);
    weekMap.set(w, (weekMap.get(w) ?? 0) + minutes);
  }
  const weeks: WeekHours[] = [...weekMap.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([ws, minutes]) => {
      const ot = applyOvertime ? Math.max(0, minutes - thresholdMinutes) : 0;
      return { weekStart: ws, minutes, regularMinutes: minutes - ot, overtimeMinutes: ot };
    });
  const totalMinutes = weeks.reduce((s, w) => s + w.minutes, 0);
  const overtimeMinutes = weeks.reduce((s, w) => s + w.overtimeMinutes, 0);
  return { byDate, weeks, totalMinutes, regularMinutes: totalMinutes - overtimeMinutes, overtimeMinutes };
}

export function computePayroll(input: PayrollInput): PayrollResult {
  const weekStart = input.weekStart ?? 1;
  const byStaff = new Map(input.employees.map((e) => [e.staffId, e]));
  const unmatched = new Set<string>();
  for (const l of input.lines) if (!byStaff.has(l.staffId)) unmatched.add(l.staffId);
  for (const h of input.hours) if (!byStaff.has(h.staffId)) unmatched.add(h.staffId);

  const employees = input.employees.map((emp): EmployeePayroll => {
    const mine = input.lines.filter((l) => l.staffId === emp.staffId);
    const live = mine.filter((l) => !l.refunded);
    const refundedRows = mine.filter((l) => l.refunded);
    const mainRows = live.filter((l) => !isMiscKind(l.kind));
    const miscRows = live.filter((l) => isMiscKind(l.kind));

    const serviceMoney = (l: PayrollLine) => l.amtPaidCents - l.cashTipCents - l.cardTipCents;
    const mainRevenueCents = mainRows.reduce((s, l) => s + serviceMoney(l), 0);
    const commissionable = miscRows.filter((l) => l.kind !== "membership" && l.kind !== "fee" && !looksLikeMembership(l.name));
    const productSalesCents = commissionable.reduce((s, l) => s + l.amtPaidCents - l.cashTipCents - l.cardTipCents, 0);
    const cashTipsCents = live.reduce((s, l) => s + l.cashTipCents, 0);
    const cardTipsCents = live.reduce((s, l) => s + l.cardTipCents, 0);
    const ccTipFeeCents = bps(cardTipsCents, emp.ccTipFeeBps);
    const productCommissionCents = bps(productSalesCents, emp.productCommissionBps);

    // Hourly wage for anyone with a rate (hourly staff, or a guaranteed base on top of commission);
    // overtime only ever applies to hourly pay. Salary is a flat amount per run.
    const applyOt = emp.overtimeOverride ?? input.overtime;
    const paysHourly = emp.hourlyRateCents > 0 && (emp.payType === "hourly" || emp.payType === "commission");
    const hrs = computeHours(input.hours.filter((h) => h.staffId === emp.staffId), weekStart, applyOt && paysHourly);
    let wageCents = 0;
    if (paysHourly) wageCents += roundCents((hrs.regularMinutes / 60) * emp.hourlyRateCents + (hrs.overtimeMinutes / 60) * emp.hourlyRateCents * 1.5);
    if (emp.payType === "salary") wageCents += emp.salaryPerPeriodCents;

    const adjustments = input.adjustments.filter((a) => a.staffId === emp.staffId);
    const adjustmentsCents = adjustments.reduce((s, a) => s + a.amountCents, 0);

    // Service commission for anyone with a rate: the whole pay for commission providers,
    // a bonus on top of wages for employees.
    const mainCommissionCents = bps(mainRevenueCents, emp.mainCommissionBps);
    let taxCents = 0;
    let totalCents: number;
    if (emp.payType === "commission") {
      totalCents = mainCommissionCents + productCommissionCents + wageCents + cashTipsCents + cardTipsCents - ccTipFeeCents + adjustmentsCents;
    } else {
      const pay = wageCents + mainCommissionCents + cashTipsCents + cardTipsCents - ccTipFeeCents + productCommissionCents + adjustmentsCents;
      if (emp.taxDeductionCents != null) taxCents = emp.taxDeductionCents;
      else if (emp.taxDeductionBps != null) taxCents = bps(wageCents + mainCommissionCents, emp.taxDeductionBps);
      totalCents = pay - taxCents;
    }

    const revenueOk = generatesRevenue(emp.position);
    const serviceRevenueCents = revenueOk ? mainRevenueCents : 0;
    const costCents = emp.payType === "commission" ? mainCommissionCents + productCommissionCents + wageCents : wageCents + mainCommissionCents + adjustmentsCents + productCommissionCents;
    const serviceProfitCents = revenueOk ? serviceRevenueCents - costCents : 0;

    const hasActivity = mine.length > 0 || hrs.totalMinutes > 0 || adjustments.length > 0 || (emp.payType === "salary" && wageCents > 0);

    return {
      employee: emp,
      mainRows,
      miscRows,
      refundedRows,
      hoursByDate: hrs.byDate,
      weeks: hrs.weeks,
      totalMinutes: hrs.totalMinutes,
      regularMinutes: hrs.regularMinutes,
      overtimeMinutes: hrs.overtimeMinutes,
      overtimeApplied: applyOt && paysHourly,
      wageCents,
      mainRevenueCents,
      mainCommissionCents,
      productSalesCents,
      productCommissionCents,
      cashTipsCents,
      cardTipsCents,
      ccTipFeeCents,
      adjustments,
      adjustmentsCents,
      taxCents,
      totalCents,
      serviceRevenueCents,
      serviceProfitCents,
      hasActivity,
    };
  });

  return { employees, unmatchedStaffIds: [...unmatched] };
}

/** Summary-row "Rate" text, as on the salon's Summary tab ("40%", "$18.00/hr + 15%", "$1,800.00/period"). */
export function rateLabel(e: PayrollEmployee): string {
  const pct = `${(e.mainCommissionBps / 100).toFixed(e.mainCommissionBps % 100 ? 1 : 0)}%`;
  const hr = `$${(e.hourlyRateCents / 100).toFixed(2)}/hr`;
  if (e.payType === "commission") return e.hourlyRateCents > 0 ? `${pct} + ${hr}` : pct;
  const base = e.payType === "hourly" ? hr : `$${(e.salaryPerPeriodCents / 100).toFixed(2)}/period`;
  return e.mainCommissionBps > 0 ? `${base} + ${pct}` : base;
}
