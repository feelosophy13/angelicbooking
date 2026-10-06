/**
 * Pure payroll math, reproducing the salon's existing pay sheets to the cent.
 *
 * Commission (1099): main commission on service revenue (amt paid − tips, net of
 * discount) + product/package commission (memberships earn 0) + all tips − a fee
 * on card tips. Hourly/salary (W-2): wage (+ overtime when enabled) + their own
 * tips (net of the card-tip fee) + product commission + adjustments − tax.
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

    const applyOt = emp.overtimeOverride ?? input.overtime;
    const hrs = computeHours(input.hours.filter((h) => h.staffId === emp.staffId), weekStart, applyOt && emp.payType === "hourly");
    let wageCents = 0;
    if (emp.payType === "hourly") {
      wageCents = roundCents((hrs.regularMinutes / 60) * emp.hourlyRateCents + (hrs.overtimeMinutes / 60) * emp.hourlyRateCents * 1.5);
    } else if (emp.payType === "salary") {
      wageCents = emp.salaryPerPeriodCents;
    }

    const adjustments = input.adjustments.filter((a) => a.staffId === emp.staffId);
    const adjustmentsCents = adjustments.reduce((s, a) => s + a.amountCents, 0);

    let mainCommissionCents = 0;
    let taxCents = 0;
    let totalCents: number;
    if (emp.payType === "commission") {
      mainCommissionCents = bps(mainRevenueCents, emp.mainCommissionBps);
      totalCents = mainCommissionCents + productCommissionCents + cashTipsCents + cardTipsCents - ccTipFeeCents + adjustmentsCents;
    } else {
      const pay = wageCents + cashTipsCents + cardTipsCents - ccTipFeeCents + productCommissionCents + adjustmentsCents;
      if (emp.taxDeductionCents != null) taxCents = emp.taxDeductionCents;
      else if (emp.taxDeductionBps != null) taxCents = bps(wageCents, emp.taxDeductionBps);
      totalCents = pay - taxCents;
    }

    const revenueOk = generatesRevenue(emp.position);
    const serviceRevenueCents = revenueOk ? mainRevenueCents : 0;
    const costCents = emp.payType === "commission" ? mainCommissionCents + productCommissionCents : wageCents + adjustmentsCents + productCommissionCents;
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
      overtimeApplied: applyOt && emp.payType === "hourly",
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

/** Summary-row "Rate" text, as on the salon's Summary tab. */
export function rateLabel(e: PayrollEmployee): string {
  if (e.payType === "commission") return `${(e.mainCommissionBps / 100).toFixed(0)}%`;
  if (e.payType === "hourly") return `$${(e.hourlyRateCents / 100).toFixed(2)}/hr`;
  return `$${(e.salaryPerPeriodCents / 100).toFixed(2)}/period`;
}
