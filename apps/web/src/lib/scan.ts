/**
 * What a barcode scanner session needs, apart from the screen: finding the product a code belongs to, tallying scans, and checking a
 * delivery against an order. Scanners act like a keyboard: they type the code and press Enter.
 */

/** `codes` are the product's other barcodes (a case, another pack size); a scan of one adds `units` units. */
export type ScanProduct = { id: string; label: string; barcode: string | null; sku: string | null; codes?: { code: string; units: number }[] };

/** Codes as the scanner reads them: no spaces or control characters, case ignored. */
export const cleanCode = (raw: string) => raw.replace(/[\u0000-\u001f\u007f\s]/g, "").toLowerCase();

/**
 * The same barcode can be read as UPC-A (12 digits) or EAN-13 (a leading 0), so all-digit codes are compared without leading zeros.
 */
const canon = (c: string) => (/^\d+$/.test(c) ? c.replace(/^0+/, "") || "0" : c);

/** The product a scanned code belongs to, and how many units that scan stands for: main barcode (1), then another barcode (its pack size), then SKU (1). */
export function matchScan<P extends ScanProduct>(products: P[], raw: string): { product: P; units: number } | null {
  const code = cleanCode(raw);
  if (!code) return null;
  const c = canon(code);
  for (const p of products) if (p.barcode && canon(cleanCode(p.barcode)) === c) return { product: p, units: 1 };
  for (const p of products) {
    const hit = p.codes?.find((x) => canon(cleanCode(x.code)) === c);
    if (hit) return { product: p, units: Math.max(1, hit.units) };
  }
  for (const p of products) if (p.sku && canon(cleanCode(p.sku)) === c) return { product: p, units: 1 };
  return null;
}

/** The product a scanned code belongs to. Null when nothing matches. */
export const matchProduct = <P extends ScanProduct>(products: P[], raw: string): P | null => matchScan(products, raw)?.product ?? null;

export type ScanLine = { productId: string; qty: number };

/** One more of a product: bumps its line, or starts one at the top so the latest scan is the first thing you see. */
export function addScan(lines: ScanLine[], productId: string, by = 1): ScanLine[] {
  const at = lines.findIndex((l) => l.productId === productId);
  if (at < 0) return [{ productId, qty: by }, ...lines];
  return lines.map((l, i) => (i === at ? { ...l, qty: l.qty + by } : l));
}

/** A typed quantity (whole units, never negative); zero removes the line. */
export function setQty(lines: ScanLine[], productId: string, qty: number): ScanLine[] {
  const q = Math.max(0, Math.floor(Number.isFinite(qty) ? qty : 0));
  return q === 0 ? lines.filter((l) => l.productId !== productId) : lines.map((l) => (l.productId === productId ? { ...l, qty: q } : l));
}

export const totalUnits = (lines: ScanLine[]) => lines.reduce((s, l) => s + l.qty, 0);

export type OrderLineInfo = { lineId: string; productId: string; ordered: number; received: number };
export type OrderProgress = { lineId: string; productId: string; ordered: number; before: number; now: number; remaining: number; status: "waiting" | "short" | "complete" | "over" };

/** Where each line of an order stands once this delivery's scans are counted (what arrived before, plus this scan session). */
export function orderProgress(order: OrderLineInfo[], scanned: ScanLine[]): { lines: OrderProgress[]; notOnOrder: ScanLine[] } {
  const now = new Map(scanned.map((s) => [s.productId, s.qty]));
  const lines = order.map((o) => {
    const n = now.get(o.productId) ?? 0;
    const total = o.received + n;
    const status: OrderProgress["status"] = total > o.ordered ? "over" : total === o.ordered ? "complete" : n > 0 ? "short" : "waiting";
    return { lineId: o.lineId, productId: o.productId, ordered: o.ordered, before: o.received, now: n, remaining: Math.max(0, o.ordered - total), status };
  });
  const onOrder = new Set(order.map((o) => o.productId));
  return { lines, notOnOrder: scanned.filter((s) => !onOrder.has(s.productId)) };
}

/** For a count: how far each scanned product is from what the book says. */
export const countDifference = (counted: number, book: number) => counted - book;
