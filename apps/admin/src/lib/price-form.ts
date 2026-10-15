import type { PriceBook } from "@angelic/core/platform-pricing";

export type FieldDef = { key: keyof PriceBook; label: string; kind: "money" | "count" | "percent"; help: string; group: string };

export const FIELDS: FieldDef[] = [
  { key: "baseCents", label: "Base plan", kind: "money", help: "Per business, per month", group: "Plan" },
  { key: "includedLocations", label: "Locations included", kind: "count", help: "Covered by the base plan", group: "Locations and staff" },
  { key: "perLocationCents", label: "Per extra location", kind: "money", help: "Per month", group: "Locations and staff" },
  { key: "includedStaff", label: "Active staff included", kind: "count", help: "Covered by the base plan", group: "Locations and staff" },
  { key: "perStaffCents", label: "Per extra staff member", kind: "money", help: "Per month", group: "Locations and staff" },
  { key: "numberCents", label: "Dedicated text number", kind: "money", help: "Per month, while they hold one", group: "Texts" },
  { key: "smsIncluded", label: "Texts included", kind: "count", help: "Per month", group: "Texts" },
  { key: "smsUsageCents", label: "Per extra text", kind: "money", help: "Whole cents; 0.02 = 2¢", group: "Texts" },
  { key: "trialDays", label: "Free trial", kind: "count", help: "Days, for new businesses", group: "Plan" },
  { key: "trialEmailCap", label: "Emails per day before subscribing", kind: "count", help: "Per business, while on trial; 0 = no limit", group: "Plan" },
  { key: "platformFeeBps", label: "Platform fee", kind: "percent", help: "% of each card payment; 0 = none", group: "Card payments" },
];

export function money(cents: number): string {
  return (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });
}

/** "29", "29.5", "$29.00" → 2900; null for blank or invalid. */
export function parseCents(raw: string): number | null {
  const s = raw.trim().replace(/^\$/, "").replace(/,/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null;
  return Math.round(Number(s) * 100);
}

/** "0.5", "1%", "2.25" → basis points (50, 100, 225); null for blank, invalid or above 20%. */
export function parsePercentBps(raw: string): number | null {
  const s = raw.trim().replace(/%$/, "");
  if (!/^\d{1,2}(\.\d{1,2})?$/.test(s)) return null;
  const bps = Math.round(Number(s) * 100);
  return bps <= 2000 ? bps : null;
}

export function parseCount(raw: string): number | null {
  const s = raw.trim();
  return /^\d{1,7}$/.test(s) ? Number(s) : null;
}

/** Read the price fields from a form. `allowBlank` (overrides) turns an empty box into null; otherwise it is an error. */
export function readPrices(form: FormData, allowBlank: boolean): { values: Partial<Record<keyof PriceBook, number | null>>; errors: string[] } {
  const values: Partial<Record<keyof PriceBook, number | null>> = {};
  const errors: string[] = [];
  for (const f of FIELDS) {
    const raw = String(form.get(f.key) ?? "");
    if (raw.trim() === "") {
      if (allowBlank) values[f.key] = null;
      else errors.push(`${f.label} is required.`);
      continue;
    }
    const v = f.kind === "money" ? parseCents(raw) : f.kind === "percent" ? parsePercentBps(raw) : parseCount(raw);
    if (v === null) errors.push(`${f.label} is not a valid ${f.kind === "money" ? "amount" : f.kind === "percent" ? "percentage (0 to 20)" : "number"}.`);
    else values[f.key] = v;
  }
  return { values, errors };
}

export function inputValue(f: FieldDef, v: number | null | undefined): string {
  if (v == null) return "";
  return f.kind === "money" ? (v / 100).toFixed(2) : f.kind === "percent" ? String(v / 100) : String(v);
}

