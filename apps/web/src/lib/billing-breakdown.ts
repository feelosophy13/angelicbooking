/**
 * What a business pays the platform this month, as lines a person can read: from the price book and what the business
 * uses today (trial, or Stripe unreachable), or from Stripe's upcoming-invoice preview once a subscription exists. Pure
 * (no Stripe or database import) so it is unit tested; the Billing page and the Settings directory feed it.
 */
import { PRICE_FIELDS, type PriceBook } from "@angelic/core/platform-pricing";
import { PRODUCT_IDS } from "./billing-config";
import { formatMoney } from "./utils";

export type LineKind = "base" | "staff" | "location" | "number" | "sms" | "other";

export interface BreakdownLine {
  kind: LineKind;
  label: string;
  /** One line of grey helper text: the count and unit price, the allowance, the phone number. */
  detail: string;
  quantity: number;
  unitCents: number;
  cents: number;
}

export interface Breakdown {
  lines: BreakdownLine[];
  /** The fixed part of the month: plan, extras and the text number (what the Settings directory shows). */
  recurringCents: number;
  /** Text overage so far. */
  usageCents: number;
  totalCents: number;
  extraStaff: number;
  extraLocations: number;
  smsOverage: number;
}

export interface PriceBookUsage {
  locations: number;
  activeStaff: number;
  /** Every number the business holds, at the fee it was bought at. */
  numbers: { phoneNumber: string; monthlyFeeCents: number }[];
  /** Texts sent so far this period. */
  smsSent: number;
}

const LABEL: Record<LineKind, string> = { base: "Plan", staff: "Extra staff", location: "Extra locations", number: "Dedicated text number", sms: "Text messages", other: "Adjustments" };

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** "includes 1 location and 1 staff member" */
export function planIncludes(book: PriceBook): string {
  const parts: string[] = [];
  if (book.includedLocations > 0) parts.push(plural(book.includedLocations, "location"));
  if (book.includedStaff > 0) parts.push(plural(book.includedStaff, "staff member"));
  return parts.length ? `includes ${parts.join(" and ")}` : "per month";
}

function smsDetail(sent: number, book: PriceBook, currency: string): string {
  const over = Math.max(0, sent - book.smsIncluded);
  const bits = [`${plural(sent, "text")} sent`];
  if (book.smsIncluded > 0) bits.push(`${book.smsIncluded} included`);
  if (over > 0 && book.smsUsageCents > 0) bits.push(`${over} × ${formatMoney(book.smsUsageCents, currency)}`);
  else if (book.smsUsageCents > 0) bits.push(`then ${formatMoney(book.smsUsageCents, currency)} each`);
  return bits.join(", ");
}

/** The month from the price book and today's counts: what a trial business will pay, and the fallback when Stripe is unreachable. */
export function priceBookBreakdown(book: PriceBook, usage: PriceBookUsage, currency: string): Breakdown {
  const lines: BreakdownLine[] = [{ kind: "base", label: LABEL.base, detail: planIncludes(book), quantity: 1, unitCents: book.baseCents, cents: book.baseCents }];
  const extraStaff = Math.max(0, usage.activeStaff - book.includedStaff);
  if (extraStaff > 0 && book.perStaffCents > 0) {
    lines.push({ kind: "staff", label: LABEL.staff, detail: `${plural(extraStaff, "extra staff member")} × ${formatMoney(book.perStaffCents, currency)}`, quantity: extraStaff, unitCents: book.perStaffCents, cents: extraStaff * book.perStaffCents });
  }
  const extraLocations = Math.max(0, usage.locations - book.includedLocations);
  if (extraLocations > 0 && book.perLocationCents > 0) {
    lines.push({ kind: "location", label: LABEL.location, detail: `${plural(extraLocations, "extra location")} × ${formatMoney(book.perLocationCents, currency)}`, quantity: extraLocations, unitCents: book.perLocationCents, cents: extraLocations * book.perLocationCents });
  }
  for (const n of usage.numbers) {
    lines.push({ kind: "number", label: LABEL.number, detail: n.phoneNumber, quantity: 1, unitCents: n.monthlyFeeCents, cents: n.monthlyFeeCents });
  }
  const smsOverage = Math.max(0, usage.smsSent - book.smsIncluded);
  const usageCents = book.smsUsageCents > 0 ? smsOverage * book.smsUsageCents : 0;
  if (book.smsUsageCents > 0 || book.smsIncluded > 0) {
    lines.push({ kind: "sms", label: LABEL.sms, detail: smsDetail(usage.smsSent, book, currency), quantity: usage.smsSent, unitCents: book.smsUsageCents, cents: usageCents });
  }
  const recurringCents = lines.filter((l) => l.kind !== "sms").reduce((t, l) => t + l.cents, 0);
  return { lines, recurringCents, usageCents, totalCents: recurringCents + usageCents, extraStaff, extraLocations, smsOverage };
}

/** One line of Stripe's upcoming-invoice preview, reduced to what the breakdown needs (the page maps the SDK object to this). */
export interface PreviewLine {
  /** Stripe product id (`pricing.price_details.product`), null for lines that are not a product. */
  product: string | null;
  description: string | null;
  amountCents: number;
  quantity: number | null;
  /** `pricing.unit_amount_decimal`, null for tiered (text usage) prices. */
  unitAmountDecimal: string | null;
  proration: boolean;
}

export interface Preview {
  lines: PreviewLine[];
  /** The invoice total Stripe will charge, after tax and discounts. */
  totalCents: number;
}

const KIND_BY_PRODUCT: Record<string, LineKind> = {
  [PRODUCT_IDS.base]: "base",
  [PRODUCT_IDS.staff]: "staff",
  [PRODUCT_IDS.location]: "location",
  [PRODUCT_IDS.number]: "number",
  [PRODUCT_IDS.usage]: "sms",
};

/**
 * The month as Stripe will bill it. Plan, extras and the number come from the preview's lines (so a mid-month change or a
 * custom price shows as Stripe has it); the detail text comes from the price book and the local number list, which name
 * things better than Stripe's descriptions. Prorations and anything not ours fold into one "Adjustments" line, and any
 * difference between the lines and Stripe's total (tax, a discount) shows as its own line so the total always adds up.
 */
export function previewBreakdown(preview: Preview, book: PriceBook, usage: Pick<PriceBookUsage, "numbers">, currency: string): Breakdown {
  const byKind = new Map<LineKind, { quantity: number; cents: number; unitCents: number; descriptions: string[] }>();
  for (const l of preview.lines) {
    const kind: LineKind = (l.product && !l.proration && KIND_BY_PRODUCT[l.product]) || "other";
    const cur = byKind.get(kind) ?? { quantity: 0, cents: 0, unitCents: 0, descriptions: [] };
    cur.quantity += l.quantity ?? 0;
    cur.cents += l.amountCents;
    if (l.unitAmountDecimal != null) cur.unitCents = Math.round(Number(l.unitAmountDecimal));
    if (l.description) cur.descriptions.push(l.description);
    byKind.set(kind, cur);
  }
  const lines: BreakdownLine[] = [];
  const base = byKind.get("base");
  lines.push({ kind: "base", label: LABEL.base, detail: planIncludes(book), quantity: 1, unitCents: base?.unitCents ?? book.baseCents, cents: base?.cents ?? 0 });
  const staff = byKind.get("staff");
  if (staff) lines.push({ kind: "staff", label: LABEL.staff, detail: `${plural(staff.quantity, "extra staff member")} × ${formatMoney(staff.unitCents || book.perStaffCents, currency)}`, quantity: staff.quantity, unitCents: staff.unitCents || book.perStaffCents, cents: staff.cents });
  const location = byKind.get("location");
  if (location) lines.push({ kind: "location", label: LABEL.location, detail: `${plural(location.quantity, "extra location")} × ${formatMoney(location.unitCents || book.perLocationCents, currency)}`, quantity: location.quantity, unitCents: location.unitCents || book.perLocationCents, cents: location.cents });
  const number = byKind.get("number");
  if (number) {
    const numbers = usage.numbers.map((n) => n.phoneNumber).join(", ");
    lines.push({ kind: "number", label: LABEL.number, detail: numbers || plural(number.quantity, "number"), quantity: number.quantity, unitCents: number.unitCents || book.numberCents, cents: number.cents });
  }
  const sms = byKind.get("sms");
  const smsSent = sms?.quantity ?? 0;
  if (sms || book.smsUsageCents > 0 || book.smsIncluded > 0) {
    // A flat (untiered) usage price is a subscription from before texts were included: word it as Stripe charges it, not as the price book now reads.
    const flat = sms && sms.unitCents > 0 && sms.cents > 0;
    const detail = flat ? `${plural(smsSent, "text")} sent × ${formatMoney(sms.unitCents, currency)}` : smsDetail(smsSent, book, currency);
    lines.push({ kind: "sms", label: LABEL.sms, detail, quantity: smsSent, unitCents: flat ? sms.unitCents : book.smsUsageCents, cents: sms?.cents ?? 0 });
  }
  const other = byKind.get("other");
  if (other && other.cents !== 0) lines.push({ kind: "other", label: LABEL.other, detail: other.descriptions.join("; ") || "Prorated changes this period", quantity: other.quantity, unitCents: 0, cents: other.cents });
  const linesTotal = lines.reduce((t, l) => t + l.cents, 0);
  const rest = preview.totalCents - linesTotal;
  if (rest !== 0) lines.push({ kind: "other", label: rest > 0 ? "Tax" : "Discount", detail: rest > 0 ? "added by Stripe from your billing address" : "applied by Stripe", quantity: 1, unitCents: rest, cents: rest });
  const usageCents = sms?.cents ?? 0;
  const recurringCents = preview.totalCents - usageCents;
  return {
    lines,
    recurringCents,
    usageCents,
    totalCents: preview.totalCents,
    extraStaff: staff?.quantity ?? 0,
    extraLocations: location?.quantity ?? 0,
    smsOverage: Math.max(0, smsSent - book.smsIncluded),
  };
}

// ---------------------------------------------------------------------------
// Per-business pricing ("Your pricing")
// ---------------------------------------------------------------------------

export interface PricingOverride {
  field: keyof PriceBook;
  label: string;
  /** The price this business gets, worded. */
  value: string;
  /** What everyone else gets. */
  standard: string;
}

const OVERRIDE_LABEL: Record<keyof PriceBook, string> = {
  baseCents: "Plan",
  includedLocations: "Locations included",
  perLocationCents: "Each extra location",
  includedStaff: "Staff included",
  perStaffCents: "Each extra staff member",
  numberCents: "Dedicated text number",
  smsIncluded: "Texts included each month",
  smsUsageCents: "Each extra text",
  trialDays: "Free trial",
  platformFeeBps: "Platform fee on card payments",
  trialEmailCap: "Emails a day during the trial",
};

function wordFor(field: keyof PriceBook, v: number, currency: string): string {
  switch (field) {
    case "baseCents":
    case "perLocationCents":
    case "perStaffCents":
    case "numberCents":
      return `${formatMoney(v, currency)} / month`;
    case "smsUsageCents":
      return formatMoney(v, currency);
    case "trialDays":
      return plural(v, "day");
    case "platformFeeBps":
      return `${v / 100}%`;
    case "trialEmailCap":
      return v === 0 ? "no limit" : String(v);
    default:
      return String(v);
  }
}

/** The lines where the platform gave this business its own price, against the standard price book. Empty when it pays list price. */
export function pricingOverrides(platform: PriceBook, overrides: Partial<Record<keyof PriceBook, number | null>> | null | undefined, currency: string): PricingOverride[] {
  const out: PricingOverride[] = [];
  for (const field of PRICE_FIELDS) {
    const v = overrides?.[field];
    if (typeof v !== "number" || v === platform[field]) continue;
    out.push({ field, label: OVERRIDE_LABEL[field], value: wordFor(field, v, currency), standard: wordFor(field, platform[field], currency) });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Invoices
// ---------------------------------------------------------------------------

export type InvoiceStatus = "paid" | "open" | "void" | "uncollectible" | "draft";

export interface InvoiceRow {
  id: string;
  /** Stripe's invoice number ("ABCD1234-0001"), or the id while the invoice is a draft. */
  number: string;
  at: Date;
  amountCents: number;
  currency: string;
  status: InvoiceStatus;
  /** Stripe's hosted page with the PDF; null for a draft. */
  url: string | null;
}

/** Reduce a Stripe invoice (the SDK object, or any object with these fields) to what the Invoices card shows. */
export function invoiceRow(inv: { id: string; number: string | null; created: number; total: number; currency: string; status: string | null; hosted_invoice_url?: string | null; invoice_pdf?: string | null }): InvoiceRow {
  const status = (["paid", "open", "void", "uncollectible", "draft"] as const).find((s) => s === inv.status) ?? "draft";
  return { id: inv.id, number: inv.number ?? inv.id, at: new Date(inv.created * 1000), amountCents: inv.total, currency: inv.currency, status, url: inv.invoice_pdf ?? inv.hosted_invoice_url ?? null };
}

export const INVOICE_PAGE_SIZE = 12;

/** The first of the current month in the business's timezone, as the start of the usage window before a subscription exists. */
export function monthStartIn(timeZone: string, now = new Date()): Date {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).formatToParts(now);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  // The offset at `now` is close enough to the offset at the 1st for a usage window (a DST change inside the month shifts it by an hour).
  const localNow = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  const offsetMs = localNow - now.getTime();
  return new Date(Date.UTC(get("year"), get("month") - 1, 1) - offsetMs);
}
