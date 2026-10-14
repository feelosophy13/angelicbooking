import { loggableProducts, visitSupplies } from "@/server/inventory";
import { Button, Card, Input } from "@/components/ui";
import { ProductPicker } from "@/components/product-picker";
import { logSupplies, undoSupplies } from "./actions";

/** What was used on this visit, logged by whoever did the work: whole units, one product at a time, with a way to take a mistake back. */
export async function SuppliesCard({ slug, businessId, appointmentId }: { slug: string; businessId: string; appointmentId: string }) {
  const [v, products] = await Promise.all([visitSupplies(businessId, appointmentId), loggableProducts(businessId)]);
  return (
    <Card className="p-4">
      <h2 className="mb-1 font-medium">Supplies used</h2>
      <p className="mb-3 text-xs text-stone-500">Whole units, as you use them up. They come off the stock at this visit's location.</p>
      {v.logged.length ? (
        <ul className="mb-3 divide-y divide-stone-100 text-sm">
          {v.logged.map((l) => (
            <li key={l.productId} className="flex items-center justify-between gap-2 py-1.5">
              <span>{l.label} <span className="text-stone-500">× {l.qty}</span></span>
              <form action={undoSupplies}>
                <input type="hidden" name="slug" value={slug} />
                <input type="hidden" name="appointmentId" value={appointmentId} />
                <input type="hidden" name="productId" value={l.productId} />
                <input type="hidden" name="qty" value={l.qty} />
                <button className="text-xs text-stone-500 underline hover:text-red-600">Take back</button>
              </form>
            </li>
          ))}
        </ul>
      ) : null}
      <form action={logSupplies} className="flex flex-wrap items-center gap-2">
        <input type="hidden" name="slug" value={slug} />
        <input type="hidden" name="appointmentId" value={appointmentId} />
        <div className="min-w-[12rem] flex-1"><ProductPicker name="extraProductId" products={products} placeholder="Find a product…" /></div>
        <Input name="extraQty" type="number" min={1} defaultValue={1} aria-label="Units used" className="w-16 text-right" />
        <Button type="submit" size="sm" variant="secondary">Log</Button>
      </form>
    </Card>
  );
}
