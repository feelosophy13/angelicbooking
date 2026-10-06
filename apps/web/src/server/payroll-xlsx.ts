import ExcelJS from "exceljs";
import { generatesRevenue, rateLabel, type EmployeePayroll, type PayrollLine, type PayrollResult } from "@angelic/core";

/**
 * Builds the salon's payroll workbook: a Summary tab first, then one tab per
 * employee with activity — the detailed commission sheet for 1099 providers and
 * the simple Pay / Tax Deductions / Total Check sheet for hourly and salaried
 * staff (tax left at $0 unless configured; the accountant fills it in).
 */

const HEADER_FILL: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF2F4157" } };
const COLHEAD_FILL: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFD9E1F2" } };
const SECTION_FILL: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEDEDED" } };
const CHECK_FILL: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE2EFDA" } };
const MONEY = '"$"#,##0.00;[Red]-"$"#,##0.00';
const COLS = ["Appointment Date", "Customer", "Service", "Checkout By", "Cash", "Cash TIP", "Credit Card", "CC Tip", "Disc", "Amt Paid", "Total"];

const $ = (c: number) => c / 100;
const h = (min: number) => Math.round((min / 60) * 100) / 100;

function tabName(name: string, used: Set<string>) {
  let base = name.replace(/[\\/?*[\]:]/g, " ").slice(0, 28) || "Employee";
  let n = base;
  let i = 2;
  while (used.has(n)) n = `${base} ${i++}`;
  used.add(n);
  return n;
}

function moneyRow(ws: ExcelJS.Worksheet, values: (string | number | null)[], opts: { fill?: ExcelJS.Fill; bold?: boolean; moneyFrom?: number } = {}) {
  const row = ws.addRow(values);
  row.eachCell({ includeEmpty: true }, (cell, col) => {
    if (opts.fill) cell.fill = opts.fill;
    if (opts.bold) cell.font = { bold: true };
    if (typeof cell.value === "number" && col >= (opts.moneyFrom ?? 5)) cell.numFmt = MONEY;
  });
  return row;
}

function title(ws: ExcelJS.Worksheet, text: string, period: string, salon: string) {
  const r = ws.addRow([`${salon} — ${text}`]);
  r.font = { bold: true, size: 13, color: { argb: "FFFFFFFF" } };
  r.eachCell({ includeEmpty: true }, (c) => (c.fill = HEADER_FILL));
  ws.mergeCells(r.number, 1, r.number, COLS.length);
  ws.addRow([`Pay period: ${period}`]).font = { italic: true };
  ws.addRow([]);
}

function linesSection(ws: ExcelJS.Worksheet, label: string, rows: PayrollLine[], dateHeader: string) {
  const s = ws.addRow([label]);
  s.font = { bold: true };
  s.eachCell({ includeEmpty: true }, (c) => (c.fill = SECTION_FILL));
  ws.mergeCells(s.number, 1, s.number, COLS.length);
  moneyRow(ws, [dateHeader, ...COLS.slice(1)], { fill: COLHEAD_FILL, bold: true, moneyFrom: 99 });
  const t = { cash: 0, cashTip: 0, card: 0, cardTip: 0, disc: 0, amt: 0, total: 0 };
  for (const l of rows) {
    const total = l.amtPaidCents + l.discountCents;
    moneyRow(ws, [l.date, l.customer, l.name, l.checkoutBy ?? "", $(l.cashCents), $(l.cashTipCents), $(l.cardCents), $(l.cardTipCents), $(l.discountCents), $(l.amtPaidCents), $(total)]);
    t.cash += l.cashCents; t.cashTip += l.cashTipCents; t.card += l.cardCents; t.cardTip += l.cardTipCents; t.disc += l.discountCents; t.amt += l.amtPaidCents; t.total += total;
  }
  moneyRow(ws, ["", "", "Total", "", $(t.cash), $(t.cashTip), $(t.card), $(t.cardTip), $(t.disc), $(t.amt), $(t.total)], { bold: true });
  ws.addRow([]);
}

function commissionSheet(ws: ExcelJS.Worksheet, e: EmployeePayroll, period: string, salon: string) {
  title(ws, `${e.employee.name} — Commission Pay Sheet`, period, salon);
  linesSection(ws, "Misc Services (products, packages, memberships)", e.miscRows, "Transaction Date");
  linesSection(ws, "Main Services", e.mainRows, "Appointment Date");
  if (e.refundedRows.length) linesSection(ws, "Refunded Transactions (listed, not paid)", e.refundedRows, "Appointment Date");
  const sum = (label: string, cents: number, fill?: ExcelJS.Fill) => moneyRow(ws, ["", "", label, "", null, null, null, null, null, $(cents)], { bold: !!fill, fill, moneyFrom: 10 });
  sum(`Main Services (${(e.employee.mainCommissionBps / 100).toFixed(0)}%)`, e.mainCommissionCents);
  if (e.productSalesCents) sum(`Misc – Product/Package Sale (${(e.employee.productCommissionBps / 100).toFixed(0)}%)`, e.productCommissionCents);
  sum("Cash Tips", e.cashTipsCents);
  sum("Card Tips", e.cardTipsCents);
  if (e.ccTipFeeCents) sum(`Fees on CC Tip (${(e.employee.ccTipFeeBps / 100).toFixed(1)}%)`, -e.ccTipFeeCents);
  for (const a of e.adjustments) sum(a.label, a.amountCents);
  sum("Total 1099", e.totalCents, CHECK_FILL);
  ws.columns = [{ width: 16 }, { width: 22 }, { width: 30 }, { width: 16 }, { width: 11 }, { width: 11 }, { width: 12 }, { width: 11 }, { width: 10 }, { width: 12 }, { width: 12 }];
}

function simpleSheet(ws: ExcelJS.Worksheet, e: EmployeePayroll, period: string, salon: string) {
  const emp = e.employee;
  title(ws, `${emp.name} — ${emp.payType === "hourly" ? "Hourly" : "Salary"} Pay Sheet`, period, salon);
  const row = (a: string, b: string | number | null, c: number | null, opts?: { fill?: ExcelJS.Fill; bold?: boolean }) => moneyRow(ws, [a, b, c], { ...opts, moneyFrom: 3 });
  if (emp.payType === "hourly") {
    row("Rate", `$${(emp.hourlyRateCents / 100).toFixed(2)}/hr`, null);
    row("Hours worked", h(e.totalMinutes), null);
    if (e.overtimeMinutes) {
      row("Regular hours", h(e.regularMinutes), $(Math.round((e.regularMinutes / 60) * emp.hourlyRateCents)));
      row("Overtime hours (1.5×)", h(e.overtimeMinutes), $(e.wageCents - Math.round((e.regularMinutes / 60) * emp.hourlyRateCents)));
    }
    row("Pay", "", $(e.wageCents), { bold: true });
  } else {
    row("Salary for period", "", $(e.wageCents), { bold: true });
  }
  if (e.cashTipsCents) row("Cash Tips", "from procedures performed", $(e.cashTipsCents));
  if (e.cardTipsCents) row("Card Tips", "from procedures performed", $(e.cardTipsCents));
  if (e.ccTipFeeCents) row(`Fees on CC Tip (${(emp.ccTipFeeBps / 100).toFixed(1)}%)`, "card fee on CC tips", -$(e.ccTipFeeCents));
  if (e.productSalesCents) row(`Product/Package Sale (${(emp.productCommissionBps / 100).toFixed(0)}%)`, `on $${$(e.productSalesCents).toFixed(2)}`, $(e.productCommissionCents));
  for (const a of e.adjustments) row(a.label, "adjustment", $(a.amountCents));
  row(emp.taxDeductionBps != null && emp.taxDeductionCents == null ? `Tax Deductions (${(emp.taxDeductionBps / 100).toFixed(1)}%)` : "Tax Deductions", e.taxCents ? "" : "entered by accountant", e.taxCents ? -$(e.taxCents) : 0);
  row("Total Check", "", $(e.totalCents), { bold: true, fill: CHECK_FILL });
  ws.addRow([]);
  if (e.hoursByDate.length) {
    moneyRow(ws, ["Hours worked", "Date", "Hours"], { fill: COLHEAD_FILL, bold: true, moneyFrom: 99 });
    for (const d of e.hoursByDate) ws.addRow(["", d.date, h(d.minutes)]);
    ws.addRow([]);
  }
  if (e.mainRows.length) {
    const s = ws.addRow(["Procedures performed"]); s.font = { bold: true }; s.eachCell({ includeEmpty: true }, (c) => (c.fill = SECTION_FILL));
    moneyRow(ws, ["Appointment Date", "Customer", "Service", "CC Tip", "Cash Tip"], { fill: COLHEAD_FILL, bold: true, moneyFrom: 99 });
    for (const l of e.mainRows) moneyRow(ws, [l.date, l.customer, l.name, $(l.cardTipCents), $(l.cashTipCents)], { moneyFrom: 4 });
    ws.addRow([]);
  }
  if (e.miscRows.length) {
    const s = ws.addRow(["Products & Package Sales"]); s.font = { bold: true }; s.eachCell({ includeEmpty: true }, (c) => (c.fill = SECTION_FILL));
    moneyRow(ws, ["Transaction Date", "Customer", "Item", "Amt Paid"], { fill: COLHEAD_FILL, bold: true, moneyFrom: 99 });
    for (const l of e.miscRows) moneyRow(ws, [l.date, l.customer, l.name, $(l.amtPaidCents)], { moneyFrom: 4 });
  }
  ws.columns = [{ width: 30 }, { width: 26 }, { width: 30 }, { width: 12 }, { width: 12 }];
}

export async function buildPayrollWorkbook(result: PayrollResult, opts: { salon: string; periodLabel: string; includePerformance?: boolean }): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Angelic Booking";
  const active = result.employees.filter((e) => e.hasActivity);
  const perf = opts.includePerformance ?? true;

  const summary = wb.addWorksheet("Summary");
  const t = summary.addRow([`${opts.salon} — Payroll Summary — ${opts.periodLabel}`]);
  t.font = { bold: true, size: 13, color: { argb: "FFFFFFFF" } };
  t.eachCell({ includeEmpty: true }, (c) => (c.fill = HEADER_FILL));
  const heads = ["Employee", "Position", "Pay type", "Rate", "Commission", "Wage", "Cash Tip", "Card Tip", "Fees on Card Tip", "Total", ...(perf ? ["Service Revenue Generated", "Service Profit Generated"] : [])];
  summary.mergeCells(1, 1, 1, heads.length);
  summary.addRow([]);
  moneyRow(summary, heads, { fill: COLHEAD_FILL, bold: true, moneyFrom: 99 });
  const totals = { commission: 0, wage: 0, cashTip: 0, cardTip: 0, fee: 0, total: 0, rev: 0, profit: 0 };
  for (const e of active) {
    const emp = e.employee;
    const commission = emp.payType === "commission" ? e.mainCommissionCents + e.productCommissionCents : e.productCommissionCents;
    const wage = emp.payType === "commission" ? 0 : e.wageCents + e.adjustmentsCents;
    moneyRow(summary, [emp.name, emp.position ?? "", emp.payType, rateLabel(emp), $(commission), $(wage), $(e.cashTipsCents), $(e.cardTipsCents), -$(e.ccTipFeeCents), $(e.totalCents), ...(perf ? [$(e.serviceRevenueCents), $(e.serviceProfitCents)] : [])]);
    totals.commission += commission; totals.wage += wage; totals.cashTip += e.cashTipsCents; totals.cardTip += e.cardTipsCents; totals.fee += e.ccTipFeeCents; totals.total += e.totalCents; totals.rev += e.serviceRevenueCents; totals.profit += e.serviceProfitCents;
  }
  moneyRow(summary, ["Total", "", "", "", $(totals.commission), $(totals.wage), $(totals.cashTip), $(totals.cardTip), -$(totals.fee), $(totals.total), ...(perf ? [$(totals.rev), $(totals.profit)] : [])], { bold: true });
  summary.addRow([]);
  summary.addRow(["Tax withholding for W-2 staff is left at $0 unless configured; the accountant enters it on the finished sheet."]).font = { italic: true, size: 9 };
  summary.columns = heads.map((_, i) => ({ width: i < 2 ? 22 : i < 4 ? 12 : 16 }));

  const used = new Set<string>(["Summary"]);
  for (const e of active) {
    const ws = wb.addWorksheet(tabName(e.employee.name, used));
    if (e.employee.payType === "commission") commissionSheet(ws, e, opts.periodLabel, opts.salon);
    else simpleSheet(ws, e, opts.periodLabel, opts.salon);
  }
  // Keep the helper referenced for future non-revenue reporting on the summary.
  void generatesRevenue;
  return Buffer.from(await wb.xlsx.writeBuffer());
}

/** W-2 only summary for the accountant: hourly + salary, no performance columns. */
export async function buildW2Workbook(result: PayrollResult, opts: { salon: string; periodLabel: string }): Promise<Buffer> {
  const w2 = { ...result, employees: result.employees.filter((e) => e.employee.payType !== "commission") };
  return buildPayrollWorkbook(w2, { ...opts, includePerformance: false });
}
