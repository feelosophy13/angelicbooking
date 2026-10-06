import { asc } from "drizzle-orm";
import { schema, withTenant } from "@angelic/db";
import { can } from "@angelic/core";
import { requireBusiness } from "@/lib/tenant";
import { formatMoney } from "@/lib/utils";
import { Button, Card, Field, Input, PageHeader, Empty } from "@/components/ui";
import { createProduct, toggleProductActive } from "./actions";

export default async function ProductsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { business, role } = await requireBusiness(slug);
  const rows = await withTenant(business.id, (tx) => tx.select().from(schema.products).orderBy(asc(schema.products.active), asc(schema.products.name)));
  const manage = can(role, "services.manage");
  return (
    <>
      <PageHeader title="Products" />
      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <Card>
          {rows.length === 0 ? (
            <div className="p-4"><Empty title="No retail products yet" body="Shampoo, styling products, gift items…" /></div>
          ) : (
            <ul className="divide-y divide-stone-200">
              {rows.map((p) => (
                <li key={p.id} className="flex items-center gap-3 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <p className={p.active ? "font-medium" : "font-medium text-stone-400 line-through"}>{p.name}</p>
                    <p className="text-xs text-stone-500">{[p.sku, p.taxable ? "taxable" : "tax-free"].filter(Boolean).join(" · ")}</p>
                  </div>
                  <span className="font-medium">{formatMoney(p.priceCents, business.currency)}</span>
                  {manage ? (
                    <form action={toggleProductActive}>
                      <input type="hidden" name="slug" value={slug} />
                      <input type="hidden" name="productId" value={p.id} />
                      <input type="hidden" name="active" value={p.active ? "false" : "true"} />
                      <Button size="sm" variant="ghost" type="submit">{p.active ? "Hide" : "Show"}</Button>
                    </form>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </Card>
        {manage ? (
          <Card className="p-4">
            <h2 className="mb-3 font-medium">Add product</h2>
            <form action={createProduct} className="space-y-3">
              <input type="hidden" name="slug" value={slug} />
              <Field label="Name"><Input name="name" required placeholder="Moisture shampoo 250ml" /></Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Price"><Input name="price" inputMode="decimal" required placeholder="24" /></Field>
                <Field label="SKU"><Input name="sku" /></Field>
              </div>
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="taxable" defaultChecked className="h-4 w-4 accent-brand-600" /> Taxable</label>
              <Button type="submit" className="w-full">Add product</Button>
            </form>
          </Card>
        ) : null}
      </div>
    </>
  );
}
