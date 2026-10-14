import Link from "next/link";
import type { Metadata } from "next";
import { Download, Pencil, Plus, Upload } from "lucide-react";

export const metadata: Metadata = { title: "Products" };
import { asc, eq } from "drizzle-orm";
import { schema, withTenant } from "@angelic/db";
import { can } from "@angelic/core";
import { requireBusiness } from "@/lib/tenant";
import { formatMoney } from "@/lib/utils";
import { Button, Card, LinkButton, PageHeader, Empty } from "@/components/ui";
import { RowLink, rowClass, rowControl } from "@/components/row";
import { Thumb } from "@/components/thumb";
import { toggleProductActive } from "./actions";
import { productLabel } from "@/lib/inventory";
import { listLocations, stockOverview } from "@/server/inventory";

export default async function ProductsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { business, permissions } = await requireBusiness(slug);
  const rows = await withTenant(business.id, (tx) =>
    tx
      .select({ p: schema.products, category: schema.productCategories.name })
      .from(schema.products)
      .leftJoin(schema.productCategories, eq(schema.productCategories.id, schema.products.categoryId))
      .orderBy(asc(schema.productCategories.sortOrder), asc(schema.productCategories.name), asc(schema.products.name), asc(schema.products.variantLabel)),
  );
  const [{ items: tracked }, locs] = await Promise.all([stockOverview(business.id), listLocations(business.id)]);
  const standing = new Map(tracked.map((i) => [i.id, i]));
  const manage = can(permissions, "services.manage");
  const canOpen = manage || can(permissions, "inventory.manage");
  const groups = new Map<string, typeof rows>();
  for (const r of rows) {
    const k = r.category ?? "Uncategorised";
    groups.set(k, [...(groups.get(k) ?? []), r]);
  }
  return (
    <>
      <PageHeader title="Products">
        {manage ? <LinkButton href={`/app/${slug}/products/categories`}>Categories</LinkButton> : null}
        {manage && rows.length ? <LinkButton href={`/app/${slug}/products/bulk`}><Pencil className="h-4 w-4" /> Edit all</LinkButton> : null}
        {manage ? <LinkButton href={`/app/${slug}/products/import`}><Upload className="h-4 w-4" /> Import</LinkButton> : null}
        {rows.length ? <LinkButton href={`/app/${slug}/products/export`}><Download className="h-4 w-4" /> Export</LinkButton> : null}
        {manage ? <LinkButton href={`/app/${slug}/products/new`} variant="primary"><Plus className="h-4 w-4" /> New product</LinkButton> : null}
      </PageHeader>
      <div className="space-y-4">
        {rows.length === 0 ? <Empty title="No retail products yet" body="Shampoo, styling products, gift items…" action={{ href: `/app/${slug}/products/new`, label: "Add a product" }} /> : null}
        {[...groups.entries()].map(([cat, list]) => (
          <Card key={cat}>
            <h2 className="border-b border-stone-200 px-4 py-2 text-sm font-semibold text-stone-600">{cat}</h2>
            <ul className="divide-y divide-stone-200">
              {list.map(({ p }) => (
                <li key={p.id} className={`flex items-center gap-3 px-4 py-3 ${canOpen ? rowClass : ""}`}>
                  <Thumb src={p.imageUrl} />
                  <div className="min-w-0 flex-1">
                    {canOpen ? (
                      <RowLink href={`/app/${slug}/products/${p.id}`} className={`font-medium ${p.active ? "" : "text-stone-400 line-through"}`}>{productLabel(p)}</RowLink>
                    ) : (
                      <p className={p.active ? "font-medium" : "font-medium text-stone-400 line-through"}>{productLabel(p)}</p>
                    )}
                    <p className="text-xs text-stone-500">{[p.kind === "backbar" ? "back-bar (not sold)" : null, p.sku, p.barcode, p.kind === "backbar" ? null : p.taxable ? "taxable" : "tax-free", p.sellOnline ? "online" : null].filter(Boolean).join(" · ")}{p.trackStock ? (() => {
                      const it = standing.get(p.id);
                      const worst = it?.alerts[0];
                      const where = worst && locs.length > 1 ? ` at ${locs.find((l) => l.id === worst.locationId)?.name.replace(`${business.name} - `, "") ?? "a location"}` : "";
                      const st = it?.status ?? "ok";
                      return <span className={`ml-2 rounded px-1.5 py-0.5 text-[11px] font-medium ${st === "negative" || st === "out" ? "bg-red-50 text-red-700" : st === "low" ? "bg-amber-50 text-amber-800" : "bg-stone-100 text-stone-600"}`}>{st === "negative" ? `Count is off${where}` : st === "out" ? `Out of stock${where}` : st === "low" && where ? `Low${where} · ${p.stockQty} in all` : `${p.stockQty} in stock`}</span>;
                    })() : null}</p>
                  </div>
                  <span className="w-28 shrink-0 text-right font-medium tabular-nums">{p.kind === "backbar" ? <span className="text-stone-400">—</span> : formatMoney(p.priceCents, business.currency)}</span>
                  {manage ? (
                    <form action={toggleProductActive} className={rowControl}>
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
