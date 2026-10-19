import ExcelJS from "exceljs";
import { onSheet, rateLabel, type EmployeePayroll, type OmittedLine, type PayrollLine, type PayrollResult } from "@angelic/core";

/**
 * The salon's payroll workbook, in the owner's own layout (the `salon-payroll` sheets):
 *   - Summary first: who, what they are paid (Hours, OT, Commission, Wage, tips, fee, Adjustments, Tax, Net) and what they brought in,
 *     with a TOTAL row that foots; the period, when it was finalized and when it was paid in the title rows.
 *   - One tab per person: the detailed commission sheet (Misc Services, Main Services, Refunded Transactions, then the pay summary in
 *     columns A/B) for 1099 providers; for W-2 staff the hours table first (weekly subtotals, Total hours), then Procedures performed,
 *     Products & Package Sales, Refunded Transactions and the Earnings table down to Total Check.
 *   - Quality Check last: every line of the period nobody was paid for here, and why.
 * Dates are real Excel dates, every total is a SUM (or ROUND) formula with its value cached so a viewer that does not recalculate still
 * shows numbers, the money format follows the business currency, header rows are frozen and each tab's main table has an autofilter
 * (Excel allows one per sheet). Nothing is recomputed here: every figure comes from the payroll result, so the page and the file agree.
 */

export interface WorkbookOpts {
  salon: string;
  /** "July 12 2026 - July 25 2026" */
  periodLabel: string;
  period?: { start: string; end: string };
  /** ISO 4217, "usd" by default. */
  currency?: string;
  /** The site this file is for (the people based there), or null for the whole business. */
  location?: string | null;
  finalizedAt?: Date | null;
  paidOn?: string | null;
  paymentRef?: string | null;
  overtime?: boolean;
  /** 0 = Sunday … 6 = Saturday; the hours table groups by this workweek. */
  weekStart?: number;
  includePerformance?: boolean;
  /** For the W-2 file: one tab per location. */
  locations?: { id: string; name: string }[];
}

const HEADER_FILL: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF2F4157" } };
const COLHEAD_FILL: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEEF1F5" } };
const SECTION_FILL: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFDCE3ED" } };
const TOTAL_FILL: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFCEFC7" } };
const CHECK_FILL: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFD5E8D4" } };
const DATE_FMT = "mmm d, yyyy";
/** Hours-worked dates carry the weekday ("Mon, Oct 5, 2026"): a roster reads by day of the week. */
const WEEKDAY_DATE_FMT = "ddd, mmm d, yyyy";
const HOURS_FMT = "0.00";

const $ = (c: number) => Math.round(c) / 100;
const hrs = (min: number) => Math.round((min / 60) * 100) / 100;
const col = (n: number) => { let s = ""; for (let x = n; x > 0; x = Math.floor((x - 1) / 26)) s = String.fromCharCode(65 + ((x - 1) % 26)) + s; return s; };
const excelDate = (iso: string) => { const [y, m, d] = iso.split("-").map(Number); return new Date(Date.UTC(y!, m! - 1, d!)); };
const payTypeText = (t: string) => (t === "commission" ? "1099" : "W-2");

/** '"$"#,##0.00;[Red]-"$"#,##0.00' for the business currency (the symbol Intl gives, e.g. "$", "CA$", "€"). */
export function moneyFormat(currency = "usd"): string {
  let symbol = "$";
  try {
    symbol = new Intl.NumberFormat("en-US", { style: "currency", currency: currency.toUpperCase() }).formatToParts(0).find((p) => p.type === "currency")?.value ?? "$";
  } catch {}
  return `"${symbol}"#,##0.00;[Red]-"${symbol}"#,##0.00`;
}

type CellValue = string | number | Date | null | { formula: string; result: number };
const sum = (c: string, from: number, to: number, result: number): CellValue => (to >= from ? { formula: `SUM(${c}${from}:${c}${to})`, result: $(result) } : $(result));
const sumCells = (refs: string[], result: number): CellValue => (refs.length ? { formula: refs.length === 1 ? refs[0]! : `SUM(${refs.join(",")})`, result: $(result) } : $(result));

class Sheet {
  r = 0;
  money: string;
  constructor(public ws: ExcelJS.Worksheet, currency: string | undefined) {
    this.money = moneyFormat(currency);
  }
  /** Write one row. `moneyFrom` (1-based) marks where currency formatting starts; dates and hours get their own formats. */
  row(values: CellValue[], opts: { fill?: ExcelJS.Fill; bold?: boolean; italic?: boolean; moneyFrom?: number; hoursCols?: number[]; textCols?: number[]; weekdayDateCols?: number[] } = {}) {
    this.r++;
    const row = this.ws.getRow(this.r);
    values.forEach((v, i) => {
      const c = row.getCell(i + 1);
      if (v === null) return;
      c.value = v as ExcelJS.CellValue;
      if (opts.fill) c.fill = opts.fill;
      if (opts.bold || opts.italic) c.font = { bold: !!opts.bold, italic: !!opts.italic };
      if (v instanceof Date) c.numFmt = opts.weekdayDateCols?.includes(i + 1) ? WEEKDAY_DATE_FMT : DATE_FMT;
      else if (opts.hoursCols?.includes(i + 1)) c.numFmt = HOURS_FMT;
      else if ((typeof v === "number" || (typeof v === "object" && "formula" in v)) && i + 1 >= (opts.moneyFrom ?? 99) && !opts.textCols?.includes(i + 1)) c.numFmt = this.money;
    });
    if (opts.fill) for (let i = values.length + 1; i <= Math.max(values.length, 1); i++) row.getCell(i).fill = opts.fill;
    return this.r;
  }
  blank() { this.r++; }
  section(title: string, width: number) {
    this.r++;
    const row = this.ws.getRow(this.r);
    row.getCell(1).value = title;
    row.getCell(1).font = { bold: true };
    for (let i = 1; i <= width; i++) row.getCell(i).fill = SECTION_FILL;
    return this.r;
  }
  widths(w: number[]) { this.ws.columns = w.map((width) => ({ width })); }
  freeze(rows: number) { this.ws.views = [{ state: "frozen", ySplit: rows }]; }
  filter(fromRow: number, toRow: number, cols: number) { if (toRow >= fromRow) this.ws.autoFilter = { from: { row: fromRow, column: 1 }, to: { row: toRow, column: cols } }; }
  print() { this.ws.pageSetup = { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0 }; }
}

function tabName(name: string, used: Set<string>) {
  const base = name.replace(/[\\/?*[\]:]/g, " ").trim().slice(0, 28) || "Employee";
  let n = base;
  let i = 2;
  while (used.has(n.toLowerCase())) n = `${base} ${i++}`;
  used.add(n.toLowerCase());
  return n;
}

const statusLine = (o: WorkbookOpts) => (o.finalizedAt ? `Finalized ${new Intl.DateTimeFormat("en-US", { dateStyle: "medium" }).format(o.finalizedAt)}${o.paidOn ? ` · paid ${new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeZone: "UTC" }).format(excelDate(o.paidOn))}${o.paymentRef ? ` (${o.paymentRef})` : ""}` : " · not yet marked paid"}` : "Draft: not finalized");

// ---------------------------------------------------------------------------
// Commission provider (1099): the owner's detailed sheet
// ---------------------------------------------------------------------------
const TX_COLS = ["Checkout By", "Customer", "Service", "Cash", "Cash TIP", "Credit Card", "CC Tip", "Disc", "Amt Paid", "Total"];
const TX_W = 11;

/** A transactions section. Returns the row of its Total line (so summary formulas can point at it). */
function txSection(s: Sheet, title: string, rows: PayrollLine[], dateLabel: string, withTotals = true) {
  s.section(title, TX_W);
  const head = s.row([dateLabel, ...TX_COLS], { fill: COLHEAD_FILL, bold: true });
  const first = s.r + 1;
  const t = { cash: 0, cashTip: 0, card: 0, cardTip: 0, disc: 0, amt: 0 };
  for (const l of rows) {
    s.row([excelDate(l.date), l.checkoutBy ?? "", l.customer, l.name, $(l.cashCents), $(l.cashTipCents), $(l.cardCents), $(l.cardTipCents), $(l.discountCents), $(l.amtPaidCents), $(l.amtPaidCents)], { moneyFrom: 5 });
    t.cash += l.cashCents; t.cashTip += l.cashTipCents; t.card += l.cardCents; t.cardTip += l.cardTipCents; t.disc += l.discountCents; t.amt += l.amtPaidCents;
  }
  const last = s.r;
  let totalRow = 0;
  if (withTotals) {
    totalRow = s.row(["", "", "", "Total", sum("E", first, last, t.cash), sum("F", first, last, t.cashTip), sum("G", first, last, t.card), sum("H", first, last, t.cardTip), sum("I", first, last, t.disc), sum("J", first, last, t.amt), sum("K", first, last, t.amt)], { fill: TOTAL_FILL, bold: true, moneyFrom: 5 });
  }
  s.blank();
  return { head, first, last, totalRow, totals: t };
}

/** A $0 product line (a freebie, a sample) earns nothing and only clutters the sheet; refunds and tips are never dropped. */
const worthListing = (l: PayrollLine) => l.kind === "service" || l.amtPaidCents !== 0 || l.cashTipCents !== 0 || l.cardTipCents !== 0 || l.discountCents !== 0;

function commissionSheet(ws: ExcelJS.Worksheet, e: EmployeePayroll, o: WorkbookOpts) {
  const s = new Sheet(ws, o.currency);
  const emp = e.employee;
  s.row(["Date range", "Service Provider", "Salon", "Status"], { bold: true });
  s.row([o.periodLabel, emp.name, `${o.salon}${o.location ? ` (${o.location})` : ""}`, statusLine(o)]);
  s.blank();
  const misc = txSection(s, "Misc Services (products, packages, memberships)", e.miscRows.filter(worthListing), "Transaction Date");
  const main = txSection(s, "Main Services", e.mainRows, "Appointment Date");
  if (e.refundedRows.length) txSection(s, "Refunded Transactions (listed, not counted toward pay)", e.refundedRows, "Transaction Date", false);
  s.filter(main.head, main.last, TX_W);

  // Pay summary in columns A/B, the owner's way. Where the figure is a plain rate on a column total it is a formula; a mid-period rate
  // change pays line by line, so those stay values (the page explains the change).
  const dated = !!emp.ratesFrom?.length;
  const lines: number[] = [];
  const line = (label: string, v: CellValue, fill?: ExcelJS.Fill) => { lines.push(s.row([label, v], { bold: true, fill, moneyFrom: 2 })); };
  const mainBase = main.totalRow ? `(J${main.totalRow}-F${main.totalRow}-H${main.totalRow})` : null;
  line(`Main Services (${(emp.mainCommissionBps / 100).toFixed(emp.mainCommissionBps % 100 ? 1 : 0)}%)`, mainBase && !dated ? { formula: `ROUND(${mainBase}*${emp.mainCommissionBps / 10_000},2)`, result: $(e.mainCommissionCents) } : $(e.mainCommissionCents));
  if (e.wageCents) line(`Hourly base (${hrs(e.totalMinutes)} h × ${(emp.hourlyRateCents / 100).toFixed(2)}${e.overtimeApplied && e.overtimeMinutes ? `, ${hrs(e.overtimeMinutes)} h overtime` : ""})`, $(e.wageCents));
  if (e.feeShareCents) line("No-show and late-cancellation fees (provider's share)", $(e.feeShareCents));
  if (e.productSalesCents || e.miscRows.length) line(`Misc – Product/Package Sale (${(emp.productCommissionBps / 100).toFixed(emp.productCommissionBps % 100 ? 1 : 0)}%) on ${$(e.productSalesCents).toFixed(2)}`, $(e.productCommissionCents));
  const tipRefs = (c: string) => [misc.totalRow, main.totalRow].filter(Boolean).map((r) => `${c}${r}`);
  line("Cash Tips", sumCells(tipRefs("F"), e.cashTipsCents));
  line("Card Tips", sumCells(tipRefs("H"), e.cardTipsCents));
  if (e.ccTipFeeCents || emp.ccTipFeeBps) {
    const cardTipRow = lines[lines.length - 1]!;
    line(`Fees on CC Tip (${(emp.ccTipFeeBps / 100).toFixed(1)}%)`, dated ? -$(e.ccTipFeeCents) : { formula: `-ROUND(B${cardTipRow}*${emp.ccTipFeeBps / 10_000},2)`, result: -$(e.ccTipFeeCents) });
  }
  for (const a of e.adjustments) line(a.label, $(a.amountCents));
  const first = lines[0]!;
  const last = lines[lines.length - 1]!;
  s.row(["Total 1099", { formula: `SUM(B${first}:B${last})`, result: $(e.totalCents) }], { bold: true, fill: CHECK_FILL, moneyFrom: 2 });
  s.widths([18, 16, 22, 30, 10, 10, 12, 10, 9, 11, 11]);
  s.freeze(2);
  s.print();
}

// ---------------------------------------------------------------------------
// Hourly / salary (W-2): the owner's simple sheet
// ---------------------------------------------------------------------------
const weekStartOf = (date: string, weekStart: number) => { const d = excelDate(date); const diff = (d.getUTCDay() - weekStart + 7) % 7; d.setUTCDate(d.getUTCDate() - diff); return d.toISOString().slice(0, 10); };

function simpleSheet(ws: ExcelJS.Worksheet, e: EmployeePayroll, o: WorkbookOpts) {
  const s = new Sheet(ws, o.currency);
  const emp = e.employee;
  s.row([emp.name, "Pay period", "Salon", "Status"], { bold: true });
  s.row([emp.position ?? "", o.periodLabel, `${o.salon}${o.location ? ` (${o.location})` : ""}`, statusLine(o)]);
  s.blank();

  // Hours worked, by workweek, with a subtotal per week (a week over 40 h is highlighted) and Total hours.
  let totalHoursRow = 0;
  if (emp.payType === "hourly" || e.hoursByDate.length) {
    s.row(["Hours worked", "Date", "Hours"], { fill: COLHEAD_FILL, bold: true });
    const weeks = new Map<string, { date: string; minutes: number }[]>();
    for (const d of e.hoursByDate) { const w = weekStartOf(d.date, o.weekStart ?? 1); weeks.set(w, [...(weeks.get(w) ?? []), d]); }
    const subtotalRows: number[] = [];
    for (const [w, days] of [...weeks.entries()].sort(([a], [b]) => a.localeCompare(b))) {
      const first = s.r + 1;
      for (const d of days) s.row(["", excelDate(d.date), hrs(d.minutes)], { hoursCols: [3], weekdayDateCols: [2] });
      const minutes = days.reduce((n, d) => n + d.minutes, 0);
      const over = minutes > 40 * 60;
      subtotalRows.push(s.row(["", `Week of ${new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" }).format(excelDate(w))} — subtotal`, { formula: `SUM(C${first}:C${s.r})`, result: hrs(minutes) }], { italic: true, bold: over, fill: over ? TOTAL_FILL : undefined, hoursCols: [3] }));
    }
    totalHoursRow = s.row(["", "Total hours", subtotalRows.length ? { formula: subtotalRows.length === 1 ? `C${subtotalRows[0]}` : `SUM(${subtotalRows.map((r) => `C${r}`).join(",")})`, result: hrs(e.totalMinutes) } : 0], { bold: true, fill: SECTION_FILL, hoursCols: [3] });
    if (e.overtimeApplied && (e.overtimeMinutes || e.doubleMinutes)) s.row(["", `of which overtime ${hrs(e.overtimeMinutes)} h${e.doubleMinutes ? `, double time ${hrs(e.doubleMinutes)} h` : ""}`, null], { italic: true });
    if (!e.hoursByDate.length) s.row(["", "No hours clocked this period", null], { italic: true });
    s.blank();
  }

  // Procedures performed (with tips), Products & Package Sales (memberships earn nothing and are listed under Other), refunds.
  let procRow = 0;
  let procHead = 0;
  let procLast = 0;
  if (e.mainRows.length) {
    s.section("Procedures performed", 7);
    // Amt Paid is the service amount without tips: the base the service commission (if any) is figured on.
    procHead = s.row(["Appointment Date", "Checkout By", "Customer", "Service", "Amt Paid", "Card Tip", "Cash Tip"], { fill: COLHEAD_FILL, bold: true });
    const first = s.r + 1;
    for (const l of e.mainRows) s.row([excelDate(l.date), l.checkoutBy ?? "", l.customer, l.name, $(l.amtPaidCents - l.cashTipCents - l.cardTipCents), $(l.cardTipCents), $(l.cashTipCents)], { moneyFrom: 5 });
    procLast = s.r;
    procRow = s.row(["", "", "", "Total", sum("E", first, s.r, e.mainRows.reduce((n, l) => n + l.amtPaidCents - l.cashTipCents - l.cardTipCents, 0)), sum("F", first, s.r, e.mainRows.reduce((n, l) => n + l.cardTipCents, 0)), sum("G", first, s.r, e.mainRows.reduce((n, l) => n + l.cashTipCents, 0))], { fill: TOTAL_FILL, bold: true, moneyFrom: 5 });
    s.blank();
  }
  const products = e.miscRows.filter((l) => (l.kind === "product" || l.kind === "package") && worthListing(l));
  const other = e.miscRows.filter((l) => !(l.kind === "product" || l.kind === "package") && l.kind !== "fee" && worthListing(l));
  let prodRow = 0;
  if (products.length) {
    s.section("Products & Package Sales", 5);
    s.row(["Transaction Date", "Checkout By", "Customer", "Item", "Amount"], { fill: COLHEAD_FILL, bold: true });
    const first = s.r + 1;
    for (const l of products) s.row([excelDate(l.date), l.checkoutBy ?? "", l.customer, l.name, $(l.amtPaidCents - l.cashTipCents - l.cardTipCents)], { moneyFrom: 5 });
    prodRow = s.row(["", "", "", "Total", sum("E", first, s.r, products.reduce((n, l) => n + l.amtPaidCents - l.cashTipCents - l.cardTipCents, 0))], { fill: TOTAL_FILL, bold: true, moneyFrom: 5 });
    s.blank();
  }
  if (other.length) {
    s.section("Memberships and other sales (no commission)", 5);
    s.row(["Transaction Date", "Checkout By", "Customer", "Item", "Amount"], { fill: COLHEAD_FILL, bold: true });
    for (const l of other) s.row([excelDate(l.date), l.checkoutBy ?? "", l.customer, l.name, $(l.amtPaidCents)], { moneyFrom: 5 });
    s.blank();
  }
  if (e.refundedRows.length) {
    s.section("Refunded Transactions (listed, not counted toward pay)", 5);
    s.row(["Transaction Date", "Checkout By", "Customer", "Service", "Amt Paid"], { fill: COLHEAD_FILL, bold: true });
    for (const l of e.refundedRows) s.row([excelDate(l.date), l.checkoutBy ?? "", l.customer, l.name, $(l.amtPaidCents)], { moneyFrom: 5 });
    s.blank();
  }
  if (procHead) s.filter(procHead, procLast, 7);

  // Earnings: pay, then what they keep from the floor, adjustments, tax, Total Check.
  s.row(["Earnings", "Detail", "Amount"], { fill: COLHEAD_FILL, bold: true });
  const dated = !!emp.ratesFrom?.length;
  const payRows: number[] = [];
  if (emp.payType === "hourly") {
    const rate = emp.hourlyRateCents / 100;
    if (e.overtimeApplied && (e.overtimeMinutes || e.doubleMinutes)) {
      const at = (minutes: number, x: number) => Math.round((minutes / 60) * emp.hourlyRateCents * x);
      payRows.push(s.row(["Regular pay", `${hrs(e.regularMinutes).toFixed(2)} hrs × ${rate.toFixed(2)}`, dated ? $(at(e.regularMinutes, 1)) : { formula: `ROUND(${hrs(e.regularMinutes)}*${rate},2)`, result: $(at(e.regularMinutes, 1)) }], { moneyFrom: 3 }));
      if (e.overtimeMinutes) payRows.push(s.row(["Overtime pay", `${hrs(e.overtimeMinutes).toFixed(2)} hrs × ${(rate * 1.5).toFixed(2)}`, dated ? $(at(e.overtimeMinutes, 1.5)) : { formula: `ROUND(${hrs(e.overtimeMinutes)}*${rate * 1.5},2)`, result: $(at(e.overtimeMinutes, 1.5)) }], { moneyFrom: 3 }));
      if (e.doubleMinutes) payRows.push(s.row(["Double-time pay", `${hrs(e.doubleMinutes).toFixed(2)} hrs × ${(rate * 2).toFixed(2)}`, $(at(e.doubleMinutes, 2))], { moneyFrom: 3 }));
      if (e.overtimeOnCommissionCents) payRows.push(s.row(["Overtime on commission and bonuses", "FLSA regular rate", $(e.overtimeOnCommissionCents)], { moneyFrom: 3 }));
    } else {
      const base = e.wageCents - e.overtimeOnCommissionCents;
      payRows.push(s.row(["Hourly pay", `${hrs(e.totalMinutes).toFixed(2)} hrs × ${rate.toFixed(2)}`, totalHoursRow && !dated ? { formula: `ROUND(C${totalHoursRow}*${rate},2)`, result: $(base) } : $(base)], { moneyFrom: 3 }));
      if (e.overtimeOnCommissionCents) payRows.push(s.row(["Overtime on commission and bonuses", "FLSA regular rate", $(e.overtimeOnCommissionCents)], { moneyFrom: 3 }));
    }
  } else {
    payRows.push(s.row(["Salary", e.wageCents === emp.salaryPerPeriodCents ? "for this pay period" : `prorated from ${(emp.salaryPerPeriodCents / 100).toFixed(2)} per pay period`, $(e.wageCents)], { moneyFrom: 3 }));
  }
  const payRow = s.row(["", "Pay", { formula: `SUM(C${payRows[0]}:C${payRows[payRows.length - 1]})`, result: $(e.wageCents) }], { fill: TOTAL_FILL, bold: true, moneyFrom: 3 });
  const extras: number[] = [];
  if (emp.mainCommissionBps > 0) extras.push(s.row([`Service commission (${(emp.mainCommissionBps / 100).toFixed(emp.mainCommissionBps % 100 ? 1 : 0)}%)`, `on ${$(e.mainRevenueCents).toFixed(2)} of services performed`, $(e.mainCommissionCents)], { moneyFrom: 3 }));
  if (e.cashTipsCents || procRow) extras.push(s.row(["Cash Tips", "tips on services performed", procRow ? { formula: `G${procRow}`, result: $(e.cashTipsCents) } : $(e.cashTipsCents)], { moneyFrom: 3 }));
  if (e.cardTipsCents || procRow) {
    const cardRow = s.row(["Card Tips", "tips on services performed", procRow ? { formula: `F${procRow}`, result: $(e.cardTipsCents) } : $(e.cardTipsCents)], { moneyFrom: 3 });
    extras.push(cardRow);
    if (emp.ccTipFeeBps) extras.push(s.row([`Fees on CC Tip (${(emp.ccTipFeeBps / 100).toFixed(1)}%)`, "card fee on CC tips", dated ? -$(e.ccTipFeeCents) : { formula: `-ROUND(C${cardRow}*${emp.ccTipFeeBps / 10_000},2)`, result: -$(e.ccTipFeeCents) }], { moneyFrom: 3 }));
  }
  if (prodRow || e.productSalesCents) extras.push(s.row([`Product/Package Sale (${(emp.productCommissionBps / 100).toFixed(emp.productCommissionBps % 100 ? 1 : 0)}%)`, `${(emp.productCommissionBps / 100).toFixed(emp.productCommissionBps % 100 ? 1 : 0)}% of product & package sales`, prodRow && !dated ? { formula: `ROUND(E${prodRow}*${emp.productCommissionBps / 10_000},2)`, result: $(e.productCommissionCents) } : $(e.productCommissionCents)], { moneyFrom: 3 }));
  if (e.feeShareCents) extras.push(s.row(["No-show and late-cancellation fees", "provider's share", $(e.feeShareCents)], { moneyFrom: 3 }));
  for (const a of e.adjustments) extras.push(s.row([a.label, "adjustment", $(a.amountCents)], { moneyFrom: 3 }));
  const taxRow = s.row(["", emp.taxDeductionBps != null && emp.taxDeductionCents == null ? `Tax Deductions (${(emp.taxDeductionBps / 100).toFixed(1)}%)` : `Tax Deductions${e.taxCents ? "" : " (entered by accountant)"}`, -$(e.taxCents)], { bold: true, moneyFrom: 3 });
  const parts = [`C${payRow}`, ...extras.map((r) => `C${r}`), `C${taxRow}`];
  s.row(["", "Total Check", { formula: `SUM(${parts.join(",")})`, result: $(e.totalCents) }], { fill: CHECK_FILL, bold: true, moneyFrom: 3 });
  s.widths([26, 28, 30, 30, 12, 12]);
  s.freeze(2);
  s.print();
}

// ---------------------------------------------------------------------------
// Summary, Quality Check, the workbook
// ---------------------------------------------------------------------------
const SUMMARY_HEADS = ["Employee", "Position", "Pay type", "Rate", "Hours", "OT hours", "Commission", "Wage", "Cash tip", "Card tip", "Card-tip fee", "Adjustments", "Tax", "Net"];
const PERF_HEADS = ["Service revenue", "Service profit"];

/** One row of the Summary (and the CSV): what each column holds, in cents or hours, straight from the engine. */
export function summaryRow(e: EmployeePayroll) {
  const emp = e.employee;
  return {
    employee: emp.name,
    position: emp.position ?? "",
    payType: payTypeText(emp.payType),
    rate: rateLabel(emp),
    hours: hrs(e.totalMinutes),
    otHours: hrs(e.overtimeMinutes + e.doubleMinutes),
    commissionCents: e.mainCommissionCents + e.productCommissionCents + (e.feeShareCents ?? 0),
    wageCents: e.wageCents,
    cashTipCents: e.cashTipsCents,
    cardTipCents: e.cardTipsCents,
    feeCents: -e.ccTipFeeCents,
    adjustmentsCents: e.adjustmentsCents,
    taxCents: -e.taxCents,
    netCents: e.totalCents,
    revenueCents: e.serviceRevenueCents,
    profitCents: e.serviceProfitCents,
  };
}

function summarySheet(ws: ExcelJS.Worksheet, people: EmployeePayroll[], o: WorkbookOpts, title: string) {
  const s = new Sheet(ws, o.currency);
  const perf = o.includePerformance ?? true;
  const heads = [...SUMMARY_HEADS, ...(perf ? PERF_HEADS : [])];
  s.row([title], { bold: true });
  ws.getRow(1).font = { bold: true, size: 13, color: { argb: "FFFFFFFF" } };
  for (let i = 1; i <= heads.length; i++) ws.getRow(1).getCell(i).fill = HEADER_FILL;
  s.row([`Pay period: ${o.periodLabel}${o.period ? ` (${o.period.start} to ${o.period.end})` : ""} · ${statusLine(o)}${o.overtime === undefined ? "" : o.overtime ? " · overtime on" : " · overtime off"}`], { italic: true });
  const head = s.row(heads, { fill: COLHEAD_FILL, bold: true });
  const first = s.r + 1;
  const tot = { hours: 0, ot: 0, commission: 0, wage: 0, cashTip: 0, cardTip: 0, fee: 0, adj: 0, tax: 0, net: 0, rev: 0, profit: 0 };
  for (const e of people) {
    const r = summaryRow(e);
    const n = s.r + 1;
    s.row([r.employee, r.position, r.payType, r.rate, r.hours, r.otHours, $(r.commissionCents), $(r.wageCents), $(r.cashTipCents), $(r.cardTipCents), $(r.feeCents), $(r.adjustmentsCents), $(r.taxCents), { formula: `SUM(G${n}:M${n})`, result: $(r.netCents) }, ...(perf ? [$(r.revenueCents), $(r.profitCents)] : [])], { moneyFrom: 7, hoursCols: [5, 6] });
    tot.hours += r.hours; tot.ot += r.otHours; tot.commission += r.commissionCents; tot.wage += r.wageCents; tot.cashTip += r.cashTipCents; tot.cardTip += r.cardTipCents; tot.fee += r.feeCents; tot.adj += r.adjustmentsCents; tot.tax += r.taxCents; tot.net += r.netCents; tot.rev += r.revenueCents; tot.profit += r.profitCents;
  }
  const last = s.r;
  const h = (c: string, v: number) => (last >= first ? { formula: `SUM(${c}${first}:${c}${last})`, result: Math.round(v * 100) / 100 } : 0);
  s.row(["TOTAL", "", "", "", h("E", tot.hours), h("F", tot.ot), sum("G", first, last, tot.commission), sum("H", first, last, tot.wage), sum("I", first, last, tot.cashTip), sum("J", first, last, tot.cardTip), sum("K", first, last, tot.fee), sum("L", first, last, tot.adj), sum("M", first, last, tot.tax), sum("N", first, last, tot.net), ...(perf ? [sum("O", first, last, tot.rev), sum("P", first, last, tot.profit)] : [])], { fill: TOTAL_FILL, bold: true, moneyFrom: 7, hoursCols: [5, 6] });
  s.blank();
  s.row(["Net = Commission + Wage + tips − card-tip fee + Adjustments − Tax. Tax for W-2 staff is 0 unless set on the person; the accountant enters withholding on the finished sheet. Pay type 1099 = commission provider, W-2 = hourly or salaried employee."], { italic: true });
  ws.getRow(s.r).font = { italic: true, size: 9 };
  s.widths([22, 20, 9, 18, 8, 9, 13, 12, 11, 11, 12, 12, 11, 13, 15, 15]);
  s.freeze(head);
  s.filter(head, last, heads.length);
  s.print();
  return tot;
}

function qualitySheet(ws: ExcelJS.Worksheet, omitted: OmittedLine[], unmatched: string[], o: WorkbookOpts) {
  const s = new Sheet(ws, o.currency);
  s.row([`Quality Check — ${o.periodLabel}: lines of this period nobody is paid for here, and why. Nothing is dropped silently.`], { bold: true });
  const head = s.row(["Date", "Sale #", "Customer", "Item", "Kind", "Staff", "Amount", "Reason", "Detail"], { fill: COLHEAD_FILL, bold: true });
  const sorted = [...omitted].sort((a, b) => a.date.localeCompare(b.date) || (a.saleNumber ?? 0) - (b.saleNumber ?? 0));
  for (const l of sorted) s.row([excelDate(l.date), l.saleNumber, l.customer, l.name, l.kind, l.staffName ?? "", $(l.amountCents), l.reason, l.detail ?? ""], { moneyFrom: 7 });
  for (const id of unmatched) s.row([null, null, "", "", "", id, null, "staff not on the roster", "pay lines reference a staff id that no longer exists"]);
  if (!sorted.length && !unmatched.length) s.row(["", "", "Nothing left out: every line of the period is on someone's sheet."], { italic: true });
  s.widths([13, 8, 22, 32, 11, 18, 11, 24, 60]);
  s.freeze(head);
  s.filter(head, s.r, 9);
  s.print();
}

export async function buildPayrollWorkbook(result: PayrollResult & { omitted?: OmittedLine[] }, opts: WorkbookOpts): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Angelic Booking";
  const people = result.employees.filter(onSheet);
  const summary = wb.addWorksheet("Summary");
  summarySheet(summary, people, opts, `${opts.salon}${opts.location ? ` (${opts.location})` : ""} — Payroll Summary — ${opts.periodLabel}`);
  const used = new Set<string>(["summary", "quality check"]);
  for (const e of people) {
    const ws = wb.addWorksheet(tabName(e.employee.name, used));
    if (e.employee.payType === "commission") commissionSheet(ws, e, opts);
    else simpleSheet(ws, e, opts);
  }
  qualitySheet(wb.addWorksheet("Quality Check"), result.omitted ?? [], result.unmatchedStaffIds, opts);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

/**
 * The accountant's W-2 file: one Summary tab per location holding that site's hourly and salaried staff (the people based there), with no
 * revenue or profit columns. Commission providers are 1099 and stay out of it.
 */
export async function buildW2Workbook(result: PayrollResult, opts: WorkbookOpts): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Angelic Booking";
  const w2 = result.employees.filter((e) => e.employee.payType !== "commission" && onSheet(e));
  const sites = opts.locations?.length ? opts.locations : [{ id: "", name: opts.salon }];
  const used = new Set<string>();
  let tabs = 0;
  for (const site of sites) {
    const people = w2.filter((e) => (sites.length === 1 ? true : (e.employee.locationId ?? "") === site.id));
    if (!people.length && sites.length > 1) continue;
    summarySheet(wb.addWorksheet(tabName(site.name, used)), people, { ...opts, includePerformance: false }, `${opts.salon}${sites.length > 1 && site.name !== opts.salon ? ` (${site.name})` : ""} — W-2 Payroll Summary — ${opts.periodLabel}`);
    tabs++;
  }
  // People with no home location, on a tab of their own, so nobody falls between sites.
  const homeless = sites.length > 1 ? w2.filter((e) => !e.employee.locationId) : [];
  if (homeless.length) summarySheet(wb.addWorksheet(tabName("No location", used)), homeless, { ...opts, includePerformance: false }, `${opts.salon} (no location set) — W-2 Payroll Summary — ${opts.periodLabel}`);
  if (!tabs && !homeless.length) summarySheet(wb.addWorksheet("W-2"), [], { ...opts, includePerformance: false }, `${opts.salon} — W-2 Payroll Summary — ${opts.periodLabel}`);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

/** The Summary tab as CSV (plain numbers, ISO dates in the header line), for import elsewhere. */
export function buildSummaryCsv(result: PayrollResult, opts: WorkbookOpts): string {
  const perf = opts.includePerformance ?? true;
  const q = (v: string | number) => (typeof v === "number" ? v.toFixed(2) : /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const heads = ["Period start", "Period end", "Location", ...SUMMARY_HEADS, ...(perf ? PERF_HEADS : [])];
  const lines = [heads.join(",")];
  const tot = { hours: 0, ot: 0, c: 0, w: 0, ct: 0, cdt: 0, f: 0, a: 0, t: 0, n: 0, r: 0, p: 0 };
  for (const e of result.employees.filter(onSheet)) {
    const r = summaryRow(e);
    lines.push([opts.period?.start ?? "", opts.period?.end ?? "", opts.location ?? "", r.employee, r.position, r.payType, r.rate, r.hours, r.otHours, $(r.commissionCents), $(r.wageCents), $(r.cashTipCents), $(r.cardTipCents), $(r.feeCents), $(r.adjustmentsCents), $(r.taxCents), $(r.netCents), ...(perf ? [$(r.revenueCents), $(r.profitCents)] : [])].map(q).join(","));
    tot.hours += r.hours; tot.ot += r.otHours; tot.c += r.commissionCents; tot.w += r.wageCents; tot.ct += r.cashTipCents; tot.cdt += r.cardTipCents; tot.f += r.feeCents; tot.a += r.adjustmentsCents; tot.t += r.taxCents; tot.n += r.netCents; tot.r += r.revenueCents; tot.p += r.profitCents;
  }
  lines.push([opts.period?.start ?? "", opts.period?.end ?? "", opts.location ?? "", "TOTAL", "", "", "", tot.hours, tot.ot, $(tot.c), $(tot.w), $(tot.ct), $(tot.cdt), $(tot.f), $(tot.a), $(tot.t), $(tot.n), ...(perf ? [$(tot.r), $(tot.p)] : [])].map(q).join(","));
  return lines.join("\n") + "\n";
}
