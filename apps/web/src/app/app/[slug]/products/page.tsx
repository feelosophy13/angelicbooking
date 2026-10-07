import Link from "next/link";
import { asc, eq } from "drizzle-orm";
import { schema, withTenant } from "@angelic/db";
import { can } from "@angelic/core";
import { requireBusiness } from "@/lib/tenant";
import { formatMoney } from "@/lib/utils";
import { Button, Card, LinkButton, PageHeader, Empty } from "@/components/ui";
import { toggleProductActive } from "./actions";

export default async function ProductsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { business, role } = await requireBusiness(slug);
  const rows = await withTenant(business.id, (tx) =>
    tx
      .select({ p: schema.products, category: schema.productCategories.name })
      .from(schema.products)
      .leftJoin(schema.productCategories, eq(schema.productCategories.id, schema.products.categoryId))
      .orderBy(asc(schema.productCategories.sortOrder), asc(schema.productCategories.name), asc(schema.products.name)),
  );
  const manage = can(role, "services.manage");
  const groups = new Map<string, typeof rows>();
  for (const r of rows) {
    const k = r.category ?? "Uncategorised";
    groups.set(k, [...(groups.get(k) ?? []), r]);
  }
  return (
    <>
      <PageHeader title="Products">
        {manage ? <LinkButton href={`/app/${slug}/products/categories`}>Categories</LinkButton> : null}
        {manage ? <LinkButton href={`/app/${slug}/products/new`} variant="primary">+ New product</LinkButton> : null}
      </PageHeader>
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
    </>
  );
}
