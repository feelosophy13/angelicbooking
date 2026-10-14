import { can } from "@angelic/core";
import { requireAction, requireBusiness } from "@/lib/tenant";
import { csvResponse } from "@/lib/csv";
import { exportProducts } from "@/server/inventory";
import { PRODUCT_CSV_HEADERS } from "@/lib/inventory";

/** Every product as a spreadsheet, in the columns the importer reads (so a round trip changes nothing). */
export async function GET(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { business, permissions } = await requireBusiness(slug);
  // Costs and suppliers are in it: for whoever manages the catalog or the stock.
  if (!can(permissions, "inventory.manage")) await requireAction(slug, "services.manage");
  const rows = await exportProducts(business.id);
  const yn = (b: boolean) => (b ? "Yes" : "No");
  return csvResponse(
    `products-${slug}.csv`,
    [...PRODUCT_CSV_HEADERS],
    rows.map((p) => [p.name, p.variantLabel, p.category, p.sku, p.barcode, p.kind === "backbar" ? "" : (p.priceCents / 100).toFixed(2), p.costCents ? (p.costCents / 100).toFixed(2) : "", yn(p.kind === "retail"), yn(p.taxable), yn(p.sellOnline), yn(p.trackStock), p.lowStockThreshold, p.reorderUpTo, p.supplierName, p.onHand]),
  );
}
