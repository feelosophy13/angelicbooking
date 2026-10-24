import { tipsPerPayment, type TipPart } from "./payroll";

/**
 * End-of-day close-out: the cash drawer's arithmetic and the closing (Z) report's totals. Pure functions over rows the server loads, so
 * the numbers on screen, in the CSV and in the tests are worked out in one place.
 */

/** US bills and coins a drawer is counted in, in cents, largest first. */
export const DENOMINATIONS: { cents: number; label: string }[] = [
  { cents: 10000, label: "$100" },
  { cents: 5000, label: "$50" },
  { cents: 2000, label: "$20" },
  { cents: 1000, label: "$10" },
  { cents: 500, label: "$5" },
  { cents: 200, label: "$2" },
  { cents: 100, label: "$1" },
  { cents: 25, label: "25¢" },
  { cents: 10, label: "10¢" },
  { cents: 5, label: "5¢" },
  { cents: 1, label: "1¢" },
];

/** A count off by more than this (either way) needs a note saying why before the drawer can close. */
export const OVER_SHORT_NOTE_CENTS = 100;

/** The total of a count by denomination ({"2000": 3, "25": 8} = $62.00). Unknown denominations and negative or fractional counts are ignored. */
export function countDenominations(counts: Record<string, number>): number {
  const known = new Set(DENOMINATIONS.map((d) => d.cents));
  let total = 0;
  for (const [k, n] of Object.entries(counts)) {
    const cents = Number(k);
    if (!known.has(cents) || !Number.isInteger(n) || n <= 0) continue;
    total += cents * n;
  }
  return total;
}

export interface DrawerFlows {
  openingFloatCents: number;
  /** Cash payments into the drawer (tips paid in cash included). */
  cashSalesCents: number;
  /** Cash handed back on refunds. */
  cashRefundsCents: number;
  /** Cash tips handed to staff out of the drawer. */
  tipPayoutsCents: number;
  payInsCents: number;
  payoutsCents: number;
}

/** What the drawer should hold: opening float + cash sales − cash refunds − cash tips paid out + pay-ins − payouts. */
export function expectedCash(f: DrawerFlows): number {
  return f.openingFloatCents + f.cashSalesCents - f.cashRefundsCents - f.tipPayoutsCents + f.payInsCents - f.payoutsCents;
}

/** Counted less expected: positive is over, negative is short. */
export function overShort(countedCents: number, expectedCents: number): number {
  return countedCents - expectedCents;
}

/** Whether a close with this difference needs a note (more than OVER_SHORT_NOTE_CENTS either way). */
export function closeNeedsNote(overShortCents: number): boolean {
  return Math.abs(overShortCents) > OVER_SHORT_NOTE_CENTS;
}

/** Totals a drawer's movements into the flows expectedCash takes. */
export function drawerFlows(input: { openingFloatCents: number; payments: { amountCents: number }[]; refunds: { amountCents: number }[]; movements: { kind: "pay_in" | "payout" | "tip_payout"; amountCents: number }[] }): DrawerFlows {
  const sum = (rows: { amountCents: number }[]) => rows.reduce((n, r) => n + r.amountCents, 0);
  const of = (k: "pay_in" | "payout" | "tip_payout") => sum(input.movements.filter((m) => m.kind === k));
  return { openingFloatCents: input.openingFloatCents, cashSalesCents: sum(input.payments), cashRefundsCents: sum(input.refunds), tipPayoutsCents: of("tip_payout"), payInsCents: of("pay_in"), payoutsCents: of("payout") };
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Closing report

/** The order payment methods are listed in on the closing report. */
export const CLOSEOUT_METHODS = ["cash", "card", "card_on_file", "terminal", "external_card", "gift_card", "store_credit", "loyalty", "other"] as const;
/** Methods whose money goes through the business's card processor (Stripe or Helcim) and so shows up in its payouts. */
export const PROCESSOR_METHODS = new Set(["card", "card_on_file", "terminal"]);

export interface CloseoutPayment {
  id: string;
  saleId: string;
  method: string;
  /** "stripe" | "helcim" */
  provider: string;
  amountCents: number;
  /** A deposit paid online at booking and applied at checkout: the processor charged it on the booking day, not today. */
  appliedDeposit: boolean;
}
export interface CloseoutRefund {
  method: string;
  provider: string;
  amountCents: number;
}
export interface CloseoutTicket {
  saleId: string;
  subtotalCents: number;
  discountCents: number;
  taxCents: number;
  tipCents: number;
  totalCents: number;
  /** Line totals before the ticket discount. */
  servicesCents: number;
  productsCents: number;
  /** The ticket's tip lines (how each was handed over) and its payments, for tips by method. */
  tips: TipPart[];
  payments: { id: string; method: string; amountCents: number }[];
}
export interface CloseoutDeposit {
  provider: string;
  amountCents: number;
}

export interface MethodRow {
  method: string;
  count: number;
  amountCents: number;
  tipsCents: number;
  refundsCents: number;
  /** Taken less refunded today. */
  netCents: number;
}
export interface ProcessorRow {
  provider: string;
  /** Card payments charged today at the desk (deposits applied today were charged when booked and are left out). */
  chargedCents: number;
  /** Deposits charged at online booking today. */
  depositsCents: number;
  refundsCents: number;
  /** Deposits given back today before they reached a ticket (cancellations, courtesy refunds): money back through the processor too. */
  depositRefundsCents: number;
  /** What should reach the payout for this day, before the processor's fees. */
  netCents: number;
}

export interface ClosingReport {
  methods: MethodRow[];
  totals: { count: number; amountCents: number; tipsCents: number; refundsCents: number; netCents: number };
  processors: ProcessorRow[];
  tickets: { count: number; subtotalCents: number; servicesCents: number; productsCents: number; otherCents: number; discountCents: number; taxCents: number; tipCents: number; totalCents: number };
  deposits: { count: number; amountCents: number };
}

/**
 * The closing report's totals. `payments` and `refunds` are those recorded on the day (a refund counts on the day it was given, whenever
 * the sale was); `tickets` are the tickets closed on the day, which decide tips by method, sales, discounts and tax (as on Reports);
 * `deposits` are the deposits taken at online booking on the day.
 */
export function closingReport(input: { payments: CloseoutPayment[]; refunds: CloseoutRefund[]; tickets: CloseoutTicket[]; deposits: CloseoutDeposit[]; /** Deposits refunded on the day while still on their appointment. */ depositRefunds?: CloseoutDeposit[] }): ClosingReport {
  const depositRefunds = input.depositRefunds ?? [];
  const tipByMethod = new Map<string, number>();
  for (const t of input.tickets) {
    const per = tipsPerPayment(t.tips, t.payments);
    for (const p of t.payments) tipByMethod.set(p.method, (tipByMethod.get(p.method) ?? 0) + (per[p.id] ?? 0));
  }
  const seen = new Set<string>([...input.payments.map((p) => p.method), ...input.refunds.map((r) => r.method), ...tipByMethod.keys()]);
  const order = [...CLOSEOUT_METHODS, ...[...seen].filter((m) => !(CLOSEOUT_METHODS as readonly string[]).includes(m)).sort()];
  const methods: MethodRow[] = order
    .filter((m) => seen.has(m))
    .map((method) => {
      const pays = input.payments.filter((p) => p.method === method);
      const amountCents = pays.reduce((n, p) => n + p.amountCents, 0);
      const refundsCents = input.refunds.filter((r) => r.method === method).reduce((n, r) => n + r.amountCents, 0);
      return { method, count: pays.length, amountCents, tipsCents: tipByMethod.get(method) ?? 0, refundsCents, netCents: amountCents - refundsCents };
    });
  const add = (k: "count" | "amountCents" | "tipsCents" | "refundsCents" | "netCents") => methods.reduce((n, r) => n + r[k], 0);
  const providers = [...new Set([...input.payments.filter((p) => PROCESSOR_METHODS.has(p.method)).map((p) => p.provider), ...input.deposits.map((d) => d.provider), ...input.refunds.filter((r) => PROCESSOR_METHODS.has(r.method)).map((r) => r.provider), ...depositRefunds.map((d) => d.provider)])].sort();
  const processors: ProcessorRow[] = providers.map((provider) => {
    const chargedCents = input.payments.filter((p) => p.provider === provider && PROCESSOR_METHODS.has(p.method) && !p.appliedDeposit).reduce((n, p) => n + p.amountCents, 0);
    const depositsCents = input.deposits.filter((d) => d.provider === provider).reduce((n, d) => n + d.amountCents, 0);
    const refundsCents = input.refunds.filter((r) => r.provider === provider && PROCESSOR_METHODS.has(r.method)).reduce((n, r) => n + r.amountCents, 0);
    const depositRefundsCents = depositRefunds.filter((d) => d.provider === provider).reduce((n, d) => n + d.amountCents, 0);
    return { provider, chargedCents, depositsCents, refundsCents, depositRefundsCents, netCents: chargedCents + depositsCents - refundsCents - depositRefundsCents };
  });
  const tsum = (k: keyof Omit<CloseoutTicket, "saleId" | "tips" | "payments">) => input.tickets.reduce((n, t) => n + t[k], 0);
  const subtotalCents = tsum("subtotalCents");
  const servicesCents = tsum("servicesCents");
  const productsCents = tsum("productsCents");
  return {
    methods,
    totals: { count: add("count"), amountCents: add("amountCents"), tipsCents: add("tipsCents"), refundsCents: add("refundsCents"), netCents: add("netCents") },
    processors,
    tickets: { count: input.tickets.length, subtotalCents, servicesCents, productsCents, otherCents: subtotalCents - servicesCents - productsCents, discountCents: tsum("discountCents"), taxCents: tsum("taxCents"), tipCents: tsum("tipCents"), totalCents: tsum("totalCents") },
    deposits: { count: input.deposits.length, amountCents: input.deposits.reduce((n, d) => n + d.amountCents, 0) },
  };
}
