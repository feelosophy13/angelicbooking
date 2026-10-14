import { and, asc, eq } from "drizzle-orm";
import { schema, withTenant } from "@angelic/db";
import { serviceUsage } from "@/server/inventory";
import { productLabel } from "@/lib/inventory";
import { Button, Card, Input, Select } from "@/components/ui";
import { setServiceProduct } from "../actions";

/**
 * What one visit of this service uses up (color, developer, foils). Each time the service is rung up, these come off the
 * stock of the location it was sold at, so the back-bar count follows the work instead of being guessed at.
 */
export async function ProductsUsed({ slug, businessId, serviceId }: { slug: string; businessId: string; serviceId: string }) {
  const [used, products] = await Promise.all([
    serviceUsage(businessId, serviceId),
    withTenant(businessId, (tx) => tx.select({ id: schema.products.id, name: schema.products.name, variantLabel: schema.products.variantLabel, kind: schema.products.kind }).from(schema.products).where(and(eq(schema.products.active, true))).orderBy(asc(schema.products.kind), asc(schema.products.name), asc(schema.products.variantLabel))),
  ]);
  const have = new Set(used.map((u) => u.productId));
  const choices = products.filter((p) => !have.has(p.id));
  return (
    <Card className="mt-5 max-w-2xl p-5">
      <h2 className="font-medium">Products used</h2>
      <p className="mb-3 text-sm text-stone-500">What a visit of this service uses up. Choose for each product: <b>taken off at checkout</b> by itself (whole units, like sheets or applicators), or <b>staff log it</b> on the appointment, with this amount as the suggestion (for things used in uneven amounts, like color or adhesive).</p>
      {used.length ? (
        <ul className="mb-3 divide-y divide-stone-100">
          {used.map((u) => (
            <li key={u.id}>
              <form action={setServiceProduct} className="flex items-center gap-2 py-1.5">
                <input type="hidden" name="slug" value={slug} />
                <input type="hidden" name="serviceId" value={serviceId} />
                <input type="hidden" name="productId" value={u.productId} />
                <span className="min-w-0 flex-1 truncate text-sm">{productLabel(u)}{u.kind === "retail" ? <span className="ml-1.5 rounded bg-sky-50 px-1.5 py-0.5 text-[11px] font-medium text-sky-800">also sold</span> : null}</span>
                <Select name="mode" defaultValue={u.mode} aria-label={`How ${productLabel(u)} is counted`} className="w-48"><option value="auto">Taken off at checkout</option><option value="log">Staff log it</option></Select>
                <Input name="quantity" type="number" min={0} defaultValue={u.quantity} aria-label={`Units of ${productLabel(u)} per visit`} className="w-20 text-right" />
                <Button type="submit" size="sm" variant="ghost">Save</Button>
                <Button type="submit" size="sm" variant="ghost" name="remove" value="1">Remove</Button>
              </form>
            </li>
          ))}
        </ul>
      ) : null}
      {choices.length ? (
        <form action={setServiceProduct} className="flex items-center gap-2">
          <input type="hidden" name="slug" value={slug} />
          <input type="hidden" name="serviceId" value={serviceId} />
          <Select name="productId" defaultValue="" aria-label="Product used">
            <option value="" disabled>Add a product…</option>
            {choices.map((p) => <option key={p.id} value={p.id}>{productLabel(p)}{p.kind === "backbar" ? " (back-bar)" : " (also sold)"}</option>)}
          </Select>
          <Select name="mode" defaultValue="auto" aria-label="How it is counted" className="w-48"><option value="auto">Taken off at checkout</option><option value="log">Staff log it</option></Select>
          <Input name="quantity" type="number" min={1} defaultValue={1} aria-label="Units per visit" className="w-20 text-right" />
          <Button type="submit" size="sm" variant="secondary">Add</Button>
        </form>
      ) : null}
    </Card>
  );
}
