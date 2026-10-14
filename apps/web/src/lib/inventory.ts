/**
 * Inventory rules that need no database: how a product is named and labelled, when stock counts as low,
 * what to reorder, how long what is left will last, and how a product spreadsheet is read. The server
 * module (server/inventory.ts) and the pages share them so the answers never differ.
 */

/** "Color Gel · 7N": products with the same name and an option label are one product sold in options. */
export const productLabel = (p: { name: string; variantLabel?: string | null }) => (p.variantLabel ? `${p.name} · ${p.variantLabel}` : p.name);

export type StockStatus = "negative" | "out" | "low" | "ok";
/** negative: more went out than the count said (the count is off); out: none left; low: at or under the warning level. */
export function stockStatus(qty: number, threshold: number): StockStatus {
  if (qty < 0) return "negative";
  if (qty === 0) return "out";
  return qty <= threshold ? "low" : "ok";
}
export type LocationAlert = { locationId: string; qty: number; onOrder: number; status: Exclude<StockStatus, "ok"> };
const SEVERITY: Record<StockStatus, number> = { negative: 0, out: 1, low: 2, ok: 3 };
export const worstStatus = (statuses: StockStatus[]): StockStatus => statuses.reduce<StockStatus>((w, s) => (SEVERITY[s] < SEVERITY[w] ? s : w), "ok");

/**
 * Where a product needs attention: each location is judged on its own count against the product's low-stock level, so twelve at the
 * main site doesn't hide none at the other. A location with none that hasn't sold or used the product lately and has none coming is
 * taken as "not stocked here" and stays quiet (a product kept at one site on purpose). A count that is off always speaks.
 * With a single location there is nothing to infer: zero is out.
 */
export function locationAlerts(input: { threshold: number; multiLocation: boolean; rows: { locationId: string; qty: number; onOrder: number; recentlyMoved: boolean }[] }): LocationAlert[] {
  const out: LocationAlert[] = [];
  for (const r of input.rows) {
    const status = stockStatus(r.qty, input.threshold);
    if (status === "ok") continue;
    if (input.multiLocation && r.qty === 0 && r.onOrder === 0 && !r.recentlyMoved) continue;
    out.push({ locationId: r.locationId, qty: r.qty, onOrder: r.onOrder, status });
  }
  return out.sort((a, b) => SEVERITY[a.status] - SEVERITY[b.status]);
}

export const needsAttention = (qty: number, threshold: number) => stockStatus(qty, threshold) !== "ok";

/**
 * How many to order so the count comes back to its target: `reorderUpTo`, else twice the warning level.
 * What is already on order counts as stock, so a product is never ordered twice. Zero when nothing is needed.
 */
export function suggestedOrderQty(p: { onHand: number; onOrder: number; threshold: number; reorderUpTo: number | null }): number {
  const have = p.onHand + p.onOrder;
  if (have > p.threshold) return 0;
  const target = Math.max(p.reorderUpTo ?? 0, p.threshold * 2, p.threshold + 1);
  return Math.max(0, target - have);
}

/** Days the count will last at the pace it sold over `periodDays`; null when nothing sold (no pace to go by). */
export function daysOfStock(onHand: number, soldInPeriod: number, periodDays: number): number | null {
  if (soldInPeriod <= 0 || periodDays <= 0) return null;
  const perDay = soldInPeriod / periodDays;
  return Math.max(0, Math.floor(onHand / perDay));
}

/** Why stock moved, in words. Every reason a movement can have is here. */
export const MOVEMENT_REASONS = {
  received: "Received",
  sale: "Sold",
  return: "Returned to shelf",
  used: "Used in services",
  adjust: "Adjusted",
  count: "Counted",
  damage: "Damaged",
  theft: "Stolen",
  expired: "Expired",
  lost: "Lost",
  supplier_return: "Sent back to supplier",
  transfer_in: "Transferred in",
  transfer_out: "Transferred out",
  opening: "Opening stock",
} as const;
export type MovementReason = keyof typeof MOVEMENT_REASONS;
export const movementReason = (r: string) => (MOVEMENT_REASONS as Record<string, string>)[r] ?? r;

/** For the history filter: reasons grouped by what they do to the shelf. */
export const REASON_GROUPS = {
  in: ["received", "return", "transfer_in", "opening"],
  out: ["sale", "used", "transfer_out", "supplier_return"],
  fixes: ["adjust", "count", "damage", "theft", "expired", "lost"],
} as const;
export const REASON_GROUP_LABELS: Record<keyof typeof REASON_GROUPS, string> = { in: "Stock coming in", out: "Stock going out", fixes: "Corrections and write-offs" };

/** A filter value ("in", "out", "fixes", or one reason) as the list of reasons it stands for; empty means every reason. */
export function reasonsFor(value: string | undefined | null): string[] {
  if (!value) return [];
  if (value in REASON_GROUPS) return [...REASON_GROUPS[value as keyof typeof REASON_GROUPS]];
  return value in MOVEMENT_REASONS ? [value] : [];
}

/** What a person may record by hand on a product. (Sales, returns, counts and transfers have their own screens.) */
export const MANUAL_REASONS = ["received", "adjust", "damage", "theft", "expired", "lost", "supplier_return", "used"] as const;
export type ManualReason = (typeof MANUAL_REASONS)[number];
export const isManualReason = (r: string): r is ManualReason => (MANUAL_REASONS as readonly string[]).includes(r);
/** Stock that left without a sale: reported as shrinkage. */
export const SHRINKAGE_REASONS = ["damage", "theft", "expired", "lost"] as const;
/** Always adds stock, so the entered number is read as positive; the others take stock away unless it is "adjust". */
export const manualDelta = (reason: ManualReason, entered: number): number => {
  if (reason === "adjust") return entered;
  if (reason === "received") return Math.abs(entered);
  return -Math.abs(entered);
};

// ---- Spreadsheet import / export ----

export const PRODUCT_CSV_HEADERS = ["Name", "Option", "Category", "SKU", "Barcode", "Price", "Cost", "Sold to clients", "Taxable", "Sell online", "Track stock", "Low-stock level", "Reorder up to", "Supplier", "On hand"] as const;

type Field = "name" | "variantLabel" | "category" | "sku" | "barcode" | "price" | "cost" | "retail" | "taxable" | "sellOnline" | "trackStock" | "lowStock" | "reorderUpTo" | "supplier" | "onHand";
const ALIASES: Record<string, Field> = {
  name: "name", product: "name", "product name": "name", title: "name",
  option: "variantLabel", variant: "variantLabel", size: "variantLabel", shade: "variantLabel",
  category: "category",
  sku: "sku",
  barcode: "barcode", upc: "barcode", ean: "barcode", gtin: "barcode",
  price: "price", "retail price": "price", "sale price": "price",
  cost: "cost", "unit cost": "cost", "cost price": "cost",
  "sold to clients": "retail", retail: "retail", "for sale": "retail",
  taxable: "taxable",
  "sell online": "sellOnline", online: "sellOnline",
  "track stock": "trackStock", "track inventory": "trackStock",
  "low-stock level": "lowStock", "low stock": "lowStock", "low stock level": "lowStock", "reorder point": "lowStock", "reorder level": "lowStock", min: "lowStock",
  "reorder up to": "reorderUpTo", "order up to": "reorderUpTo", max: "reorderUpTo",
  supplier: "supplier", vendor: "supplier",
  "on hand": "onHand", quantity: "onHand", qty: "onHand", stock: "onHand", "in stock": "onHand",
};

export type ParsedProductRow = {
  line: number;
  name: string;
  variantLabel: string | null;
  category: string | null;
  sku: string | null;
  barcode: string | null;
  priceCents: number | null;
  costCents: number | null;
  retail: boolean | null;
  taxable: boolean | null;
  sellOnline: boolean | null;
  trackStock: boolean | null;
  lowStock: number | null;
  reorderUpTo: number | null;
  supplier: string | null;
  onHand: number | null;
};

const yes = (v: string): boolean | null => {
  const s = v.trim().toLowerCase();
  if (["y", "yes", "true", "1", "x", "on"].includes(s)) return true;
  if (["n", "no", "false", "0", "off"].includes(s)) return false;
  return null;
};
const money = (v: string): number | null => {
  const s = v.replace(/[^0-9.\-]/g, "");
  if (!s) return null;
  const n = Math.round(parseFloat(s) * 100);
  return Number.isFinite(n) ? n : null;
};
const whole = (v: string): number | null => {
  const s = v.replace(/[^0-9\-]/g, "");
  if (!s) return null;
  const n = parseInt(s, 10);
  return Number.isFinite(n) ? n : null;
};

/** Read a product spreadsheet (first row = headers, any order, common alternative names accepted). A blank cell means "leave as is" (null). */
export function readProductRows(grid: string[][]): { rows: ParsedProductRow[]; errors: string[] } {
  const [head, ...body] = grid;
  if (!head) return { rows: [], errors: ["The file is empty."] };
  const cols = head.map((h) => ALIASES[h.trim().toLowerCase().replace(/\s+/g, " ")] ?? null);
  if (!cols.includes("name")) return { rows: [], errors: ['There is no "Name" column.'] };
  const errors: string[] = [];
  const rows: ParsedProductRow[] = [];
  body.forEach((cells, i) => {
    const line = i + 2;
    const get = (f: Field) => {
      const at = cols.indexOf(f);
      return at < 0 ? "" : (cells[at] ?? "").trim();
    };
    const name = get("name");
    if (!name) {
      errors.push(`Row ${line}: no name.`);
      return;
    }
    rows.push({
      line,
      name: name.slice(0, 80),
      variantLabel: get("variantLabel") || null,
      category: get("category") || null,
      sku: get("sku") || null,
      barcode: get("barcode") || null,
      priceCents: money(get("price")),
      costCents: money(get("cost")),
      retail: yes(get("retail")),
      taxable: yes(get("taxable")),
      sellOnline: yes(get("sellOnline")),
      trackStock: yes(get("trackStock")),
      lowStock: whole(get("lowStock")),
      reorderUpTo: whole(get("reorderUpTo")),
      supplier: get("supplier") || null,
      onHand: whole(get("onHand")),
    });
  });
  return { rows, errors };
}
