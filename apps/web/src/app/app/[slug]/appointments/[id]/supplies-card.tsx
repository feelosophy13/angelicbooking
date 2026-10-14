import { loggableProducts, visitSupplies } from "@/server/inventory";
import { productLabel } from "@/lib/inventory";
import { Button, Card, Input, Select } from "@/components/ui";
import { logSupplies, undoSupplies } from "./actions";

/**
 * What was really used on this visit, logged by whoever did the work. The services suggest amounts (set on the service),
 * but the person types what they used: a tube finished, two sheets, nothing. Products a service takes off by itself at checkout are only mentioned.
 */
export async function SuppliesCard({ slug, businessId, appointmentId }: { slug: string; businessId: string; appointmentId: string }) {
  const [v, products] = await Promise.all([visitSupplies(businessId, appointmentId), loggableProducts(businessId)]);
  const loggedIds = new Set(v.logged.map((l) => l.productId));
  return (
    <Card className="p-4">
      <h2 className="mb-1 font-medium">Supplies used</h2>
      <p className="mb-3 text-xs text-stone-500">Whole units, as you use them up. They come off the stock at this visit's location.{v.automatic.length ? ` ${v.automatic.join(", ")} come off by themselves at checkout.` : ""}</p>
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
      <form action={logSupplies} className="space-y-2">
        <input type="hidden" name="slug" value={slug} />
        <input type="hidden" name="appointmentId" value={appointmentId} />
        {v.suggested.filter((s) => !loggedIds.has(s.productId)).map((s) => (
          <div key={s.productId} className="grid grid-cols-[1fr_4rem] items-center gap-2 text-sm">
            <label htmlFor={`qty:${s.productId}`} className="min-w-0 truncate">{s.label} <span className="text-xs text-stone-500">· usually {s.qty}</span></label>
            <Input id={`qty:${s.productId}`} name={`qty:${s.productId}`} type="number" min={0} placeholder="0" className="text-right" />
          </div>
        ))}
        <div className="grid grid-cols-[1fr_4rem] gap-2">
          <Select name="extraProductId" defaultValue="" aria-label="Another product used">
            <option value="">Another product…</option>
            {products.map((p) => <option key={p.id} value={p.id}>{productLabel(p)}{p.kind === "backbar" ? " (back-bar)" : ""}</option>)}
          </Select>
          <Input name="extraQty" type="number" min={0} placeholder="0" aria-label="Units used" className="text-right" />
        </div>
        <Button type="submit" size="sm" variant="secondary">Log supplies</Button>
      </form>
    </Card>
  );
}
