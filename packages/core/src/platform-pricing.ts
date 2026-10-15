/**
 * What the PLATFORM charges a business per month (not what the business charges its clients;
 * that is ./pricing.ts). One default price book applies to everyone; a business may override
 * individual fields. All money is in cents.
 */
export interface PriceBook {
  /** Flat monthly fee per business. */
  baseCents: number;
  /** Locations covered by the base fee. */
  includedLocations: number;
  /** Monthly fee for each location beyond the included ones. */
  perLocationCents: number;
  /** Active staff covered by the base fee. */
  includedStaff: number;
  /** Monthly fee for each active staff member beyond the included ones. */
  perStaffCents: number;
  /** Monthly fee for a dedicated text number, while the business holds one. */
  numberCents: number;
  /** Text messages included each month. */
  smsIncluded: number;
  /** Price per text message beyond the included ones. */
  smsUsageCents: number;
  /** Free trial length for new businesses, in days. */
  trialDays: number;
  /** Share of each card payment the business takes from its clients that the platform keeps, in basis points (100 = 1%). */
  platformFeeBps: number;
  /** Emails per day a business may send until it has a subscription (0 = no limit). */
  trialEmailCap: number;
}

export const PRICE_FIELDS = [
  "baseCents",
  "includedLocations",
  "perLocationCents",
  "includedStaff",
  "perStaffCents",
  "numberCents",
  "smsIncluded",
  "smsUsageCents",
  "trialDays",
  "platformFeeBps",
  "trialEmailCap",
] as const satisfies readonly (keyof PriceBook)[];

export const DEFAULT_PRICE_BOOK: PriceBook = {
  baseCents: 0,
  includedLocations: 1,
  perLocationCents: 0,
  includedStaff: 1,
  perStaffCents: 0,
  numberCents: 0,
  smsIncluded: 0,
  smsUsageCents: 0,
  trialDays: 0,
  platformFeeBps: 0,
  trialEmailCap: 100,
};

/** The default price book with any per-business overrides applied (null/undefined = use the default). */
export function effectivePriceBook(defaults: PriceBook, overrides?: Partial<Record<keyof PriceBook, number | null>> | null): PriceBook {
  const out = { ...defaults };
  for (const k of PRICE_FIELDS) {
    const v = overrides?.[k];
    if (typeof v === "number") out[k] = v;
  }
  return out;
}

/** What a business uses, measured over the last 30 days where it is a flow. */
export interface Usage {
  locations: number;
  activeStaff: number;
  hasNumber: boolean;
  smsLast30Days: number;
}

export interface BillLine {
  label: string;
  detail: string;
  cents: number;
}

export interface Bill {
  lines: BillLine[];
  totalCents: number;
}

const usd = (cents: number) => `$${(cents / 100).toFixed(2)}`;

/** Itemised monthly estimate. Lines that cost nothing are left out, except the base fee. */
export function monthlyBill(usage: Usage, p: PriceBook): Bill {
  const lines: BillLine[] = [{ label: "Base plan", detail: "per month", cents: p.baseCents }];
  const extraLocations = Math.max(0, usage.locations - p.includedLocations);
  if (extraLocations > 0 && p.perLocationCents > 0) {
    lines.push({ label: "Extra locations", detail: `${extraLocations} × ${usd(p.perLocationCents)} (${p.includedLocations} included)`, cents: extraLocations * p.perLocationCents });
  }
  const extraStaff = Math.max(0, usage.activeStaff - p.includedStaff);
  if (extraStaff > 0 && p.perStaffCents > 0) {
    lines.push({ label: "Extra staff", detail: `${extraStaff} × ${usd(p.perStaffCents)} (${p.includedStaff} included)`, cents: extraStaff * p.perStaffCents });
  }
  if (usage.hasNumber && p.numberCents > 0) {
    lines.push({ label: "Text number", detail: "per month", cents: p.numberCents });
  }
  const extraSms = Math.max(0, usage.smsLast30Days - p.smsIncluded);
  if (extraSms > 0 && p.smsUsageCents > 0) {
    lines.push({ label: "Text messages", detail: `${extraSms} × ${usd(p.smsUsageCents)} (${p.smsIncluded} included)`, cents: extraSms * p.smsUsageCents });
  }
  return { lines, totalCents: lines.reduce((s, l) => s + l.cents, 0) };
}
