import { requireAction } from "@/lib/tenant";
import { csvResponse } from "@/lib/csv";
import { stockHistory } from "@/server/inventory";
import { movementReason } from "@/lib/inventory";
import { historyFilterFromParams } from "@/lib/history-filter";

const LIMIT = 10000;

/** The history as a spreadsheet, for whatever the page is filtered to (newest first, up to 10,000 lines). */
export async function GET(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { business } = await requireAction(slug, "inventory.manage");
  const sp = Object.fromEntries(new URL(req.url).searchParams);
  const { filter } = historyFilterFromParams(sp, business.timezone);
  const h = await stockHistory(business.id, filter, 1, LIMIT);
  const fmt = new Intl.DateTimeFormat("sv-SE", { dateStyle: "short", timeStyle: "short", timeZone: business.timezone });
  const money = (c: number | null) => (c == null ? "" : (c / 100).toFixed(2));
  return csvResponse(
    `stock-history-${slug}.csv`,
    ["When", "Product", "SKU", "Change", "Reason", "Location", "Person", "Unit cost", "Sale", "Order", "Note", "Undone"],
    h.rows.map((m) => [fmt.format(m.createdAt), m.label, m.sku, m.delta, movementReason(m.reason), m.location?.replace(`${business.name} - `, ""), m.who, money(m.unitCostCents), m.saleNumber, m.orderNumber, m.note, m.undone ? "Yes" : ""]),
  );
}
