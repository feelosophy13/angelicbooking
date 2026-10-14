/**
 * Options of a product (sizes, shades): turning what someone typed into a list of option labels, building size × shade combinations,
 * skipping options that already exist, and summing a group up for lists.
 */
import { worstStatus, type StockStatus } from "./inventory";

export const MAX_OPTIONS = 100;
const MAX_LABEL = 40;

/** One option per line (commas and semicolons also separate), trimmed, no repeats (ignoring case), at most MAX_OPTIONS. */
export function parseOptionList(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of text.split(/[\n;,]+/)) {
    const label = raw.replace(/\s+/g, " ").trim().slice(0, MAX_LABEL);
    const key = label.toLowerCase();
    if (!label || seen.has(key)) continue;
    seen.add(key);
    out.push(label);
    if (out.length >= MAX_OPTIONS) break;
  }
  return out;
}

/** A second list of options multiplies the first: shades ["7N","8N"] × sizes ["50 ml","100 ml"] gives "7N / 50 ml", "7N / 100 ml", … */
export function optionCombos(first: string[], second: string[]): string[] {
  if (!second.length) return first;
  if (!first.length) return second;
  return first.flatMap((a) => second.map((b) => `${a} / ${b}`)).slice(0, MAX_OPTIONS);
}

/** Of the labels wanted, which are new and which the product already has (compared ignoring case). */
export function newLabels(existing: string[], wanted: string[]): { add: string[]; skipped: string[] } {
  const have = new Set(existing.map((l) => l.trim().toLowerCase()));
  const add: string[] = [];
  const skipped: string[] = [];
  for (const w of wanted) (have.has(w.toLowerCase()) ? skipped : add).push(w);
  return { add, skipped };
}

export type OptionRow = { priceCents: number; stockQty: number; status: StockStatus; tracked: boolean; active: boolean };

/** How a group reads in a list: how many options, their price range, all the stock together, and the worst standing among them. */
export function groupSummary(rows: OptionRow[]) {
  const live = rows.filter((r) => r.active);
  const prices = (live.length ? live : rows).map((r) => r.priceCents);
  const tracked = rows.filter((r) => r.tracked && r.active);
  return {
    options: rows.length,
    active: live.length,
    minPrice: prices.length ? Math.min(...prices) : 0,
    maxPrice: prices.length ? Math.max(...prices) : 0,
    totalStock: tracked.reduce((s, r) => s + r.stockQty, 0),
    anyTracked: tracked.length > 0,
    worst: worstStatus(tracked.map((r) => r.status)),
  };
}

export const priceRange = (min: number, max: number, fmt: (c: number) => string) => (min === max ? fmt(min) : `${fmt(min)}–${fmt(max)}`);
