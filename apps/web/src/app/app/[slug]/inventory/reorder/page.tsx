import type { Metadata } from "next";
import Link from "next/link";
import { requireAction } from "@/lib/tenant";
import { listLocations, reorderSuggestions } from "@/server/inventory";
import { formatMoney } from "@/lib/utils";
import { Card, Empty, Input } from "@/components/ui";
import { ActionForm, SubmitButton } from "@/components/form";
import { orderFromSuggestions } from "../actions";

export const metadata: Metadata = { title: "Reorder · Inventory" };

export default async function ReorderPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { business } = await requireAction(slug, "inventory.manage");
  const [groups, locations] = await Promise.all([reorderSuggestions(business.id), listLocations(business.id)]);
  const multi = locations.length > 1;
  if (!groups.length) return <Empty title="Nothing to reorder" body="Every tracked product is above its low-stock level, or already on order." action={{ href: `/app/${slug}/inventory/orders`, label: "See orders" }} />;
  return (
    <div className="space-y-4">
      <p className="text-sm text-stone-600">Products at or under their low-stock level, counting what is already on order. Each location is judged on its own count, and its shortfall is its own order, delivered there. The amount brings each back up to its “order up to” level (set on the product). Change any quantity (0 leaves a product out) and make a draft order per supplier.</p>
      {groups.map((g) => (
        <Card key={`${g.supplierId ?? "none"}|${g.locationId}`}>
          <h2 className="border-b border-stone-200 px-4 py-2 text-sm font-semibold text-stone-600">{g.supplierName}{multi ? <span className="font-normal text-stone-500"> · for {g.locationName.replace(`${business.name} - `, "")}</span> : null}{!g.supplierId ? <span className="ml-2 font-normal text-stone-500">· set a usual supplier on each product to group them</span> : null}</h2>
          <div className="p-4">
            <ActionForm action={orderFromSuggestions}>
              <input type="hidden" name="slug" value={slug} />
              <input type="hidden" name="supplierId" value={g.supplierId ?? ""} />
              <input type="hidden" name="locationId" value={g.locationId} />
              <ul className="divide-y divide-stone-100">
                {g.items.map((i) => (
                  <li key={i.productId} className="flex items-center gap-3 py-1.5">
                    <label className="min-w-0 flex-1 text-sm">
                      <span className="font-medium">{i.name}</span>
                      <span className="block text-xs text-stone-500">{i.onHand < 0 ? `count is off (${i.onHand})` : i.onHand === 0 ? "out of stock" : `${i.onHand} left`} · low at {i.threshold}{i.onOrder ? ` · ${i.onOrder} on order` : ""}{i.unitCostCents ? ` · ${formatMoney(i.unitCostCents, business.currency)} each` : ""}</span>
                    </label>
                    <Input name={`qty:${i.productId}`} defaultValue={i.qty} inputMode="numeric" aria-label={`Quantity of ${i.name} to order`} className="w-20 text-right" />
                  </li>
                ))}
              </ul>
              <div className="flex items-center gap-3">
                <SubmitButton pendingText="Drafting…">Draft an order</SubmitButton>
                <span className="text-xs text-stone-500">Nothing is sent to the supplier until you send the order yourself.</span>
              </div>
            </ActionForm>
          </div>
        </Card>
      ))}
      <p className="text-xs text-stone-500"><Link href={`/app/${slug}/products/bulk`} className="underline">Edit all products</Link> to change low-stock levels, order-up-to levels and suppliers in one table.</p>
    </div>
  );
}
