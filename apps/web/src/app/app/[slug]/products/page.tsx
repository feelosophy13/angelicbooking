import Link from "next/link";
import { asc, eq } from "drizzle-orm";
import { schema, withTenant } from "@angelic/db";
import { can } from "@angelic/core";
import { requireBusiness } from "@/lib/tenant";
import { listCategories } from "@/server/categories";
import { formatMoney } from "@/lib/utils";
import { Button, Card, Field, Input, PageHeader, Empty } from "@/components/ui";
import { CategoryManager, CategoryPicker } from "@/components/categories";
import { createProduct, toggleProductActive } from "./actions";
import { createCategory, moveCategoryAction, removeCategory, renameCategoryAction } from "../categories-actions";

export default async function ProductsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { business, role } = await requireBusiness(slug);
  const [rows, categories] = await Promise.all([
    withTenant(business.id, (tx) =>
      tx
        .select({ p: schema.products, category: schema.productCategories.name })
        .from(schema.products)
        .leftJoin(schema.productCategories, eq(schema.productCategories.id, schema.products.categoryId))
        .orderBy(asc(schema.productCategories.sortOrder), asc(schema.productCategories.name), asc(schema.products.name)),
    ),
    listCategories(business.id, "product"),
  ]);
  const manage = can(role, "services.manage");
  const groups = new Map<string, typeof rows>();
  for (const r of rows) {
    const k = r.category ?? "Uncategorised";
    groups.set(k, [...(groups.get(k) ?? []), r]);
  }
  const counts: Record<string, number> = {};
  for (const r of rows) if (r.p.categoryId) counts[r.p.categoryId] = (counts[r.p.categoryId] ?? 0) + 1;

  return (
    <>
      <PageHeader title="Products" />
      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        <div className="space-y-4">
          {rows.length === 0 ? <Empty title="No retail products yet" body="Shampoo, styling products, gift items…" /> : null}
          {[...groups.entries()].map(([cat, list]) => (
            <Card key={cat}>
              <h2 className="border-b border-stone-200 px-4 py-2 text-sm font-semibold text-stone-600">{cat}</h2>
              <ul className="divide-y divide-stone-200">
                {list.map(({ p }) => (
                  <li key={p.id} className="flex items-center gap-3 px-4 py-3">
                    <div className="min-w-0 flex-1">
                      {manage ? (
                        <Link href={`/app/${slug}/products/${p.id}`} className={`font-medium hover:underline ${p.active ? "" : "text-stone-400 line-through"}`}>{p.name}</Link>
                      ) : (
                        <p className={p.active ? "font-medium" : "font-medium text-stone-400 line-through"}>{p.name}</p>
                      )}
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
            </Card>
          ))}
        </div>
        {manage ? (
          <div className="space-y-6">
            <CategoryManager slug={slug} kind="product" categories={categories} counts={counts} actions={{ create: createCategory, rename: renameCategoryAction, remove: removeCategory, move: moveCategoryAction }} />
            <Card className="p-4">
              <h2 className="mb-3 font-medium">Add product</h2>
              <form action={createProduct} className="space-y-3">
                <input type="hidden" name="slug" value={slug} />
                <Field label="Name"><Input name="name" required placeholder="Moisture shampoo 250ml" /></Field>
                <Field label="Category"><CategoryPicker name="categoryId" categories={categories} /></Field>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Price"><Input name="price" inputMode="decimal" required placeholder="24" /></Field>
                  <Field label="SKU"><Input name="sku" /></Field>
                </div>
                <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="taxable" defaultChecked className="h-4 w-4 accent-brand-600" /> Taxable</label>
                <Button type="submit" className="w-full">Add product</Button>
              </form>
            </Card>
          </div>
        ) : null}
      </div>
    </>
  );
}
