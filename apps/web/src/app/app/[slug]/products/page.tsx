import type { Metadata } from "next";
import Link from "next/link";
import { ChevronRight, Download, Pencil, Plus, Search, Upload } from "lucide-react";
import { asc, eq } from "drizzle-orm";
import { schema, withTenant } from "@angelic/db";
import { can } from "@angelic/core";
import { requireBusiness } from "@/lib/tenant";
import { formatMoney } from "@/lib/utils";
import { Button, Card, Input, LinkButton, PageHeader, Empty, Select } from "@/components/ui";
import { AutoSubmitForm } from "@/components/auto-submit-form";
import { RowLink, rowClass, rowControl } from "@/components/row";
import { Thumb } from "@/components/thumb";
import { toggleGroupActive, toggleProductActive } from "./actions";
import { productLabel } from "@/lib/inventory";
import { groupSummary, priceRange } from "@/lib/variants";
import { listLocations, stockOverview } from "@/server/inventory";

export const metadata: Metadata = { title: "Products" };

type Row = { p: typeof schema.products.$inferSelect; category: string | null };

export default async function ProductsPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ q?: string; show?: string }> }) {
  const { slug } = await params;
  const sp = await searchParams;
  const { business, permissions } = await requireBusiness(slug);
  const [allRows, extraCodes] = await Promise.all([withTenant(business.id, (tx) =>
    tx
      .select({ p: schema.products, category: schema.productCategories.name })
      .from(schema.products)
      .leftJoin(schema.productCategories, eq(schema.productCategories.id, schema.products.categoryId))
      .orderBy(asc(schema.productCategories.sortOrder), asc(schema.productCategories.name), asc(schema.products.name), asc(schema.products.variantLabel)),
  ), withTenant(business.id, (tx) => tx.select({ productId: schema.productBarcodes.productId, code: schema.productBarcodes.code }).from(schema.productBarcodes))]);
  const [{ items: tracked }, locs] = await Promise.all([stockOverview(business.id), listLocations(business.id)]);
  const standing = new Map(tracked.map((i) => [i.id, i]));
  // Search (name, option, SKU, barcode, another barcode, category) and a simple filter. A product with options stays whole: if any option matches, all of them show.
  const q = (sp.q ?? "").trim().toLowerCase();
  const show = ["hidden", "backbar", "attention"].includes(sp.show ?? "") ? sp.show! : "";
  const moreCodes = new Map<string, string[]>();
  for (const e of extraCodes) moreCodes.set(e.productId, [...(moreCodes.get(e.productId) ?? []), e.code]);
  const matchesRow = (r: Row) =>
    (!q || [productLabel(r.p), r.p.name, r.p.sku, r.p.barcode, r.category, ...(moreCodes.get(r.p.id) ?? [])].some((v) => v?.toLowerCase().includes(q))) &&
    (show === "" || (show === "hidden" ? !r.p.active : show === "backbar" ? r.p.kind === "backbar" : (standing.get(r.p.id)?.status ?? "ok") !== "ok"));
  const hitGroups = new Set(allRows.filter((r) => r.p.groupId && matchesRow(r)).map((r) => r.p.groupId!));
  const rows: Row[] = q || show ? allRows.filter((r) => matchesRow(r) || (r.p.groupId && hitGroups.has(r.p.groupId))) : allRows;
  const filtering = !!(q || show);
  const manage = can(permissions, "services.manage");
  const canOpen = manage || can(permissions, "inventory.manage");
  const money = (c: number) => formatMoney(c, business.currency);
  const where = (id: string | undefined) => {
    const a = id ? standing.get(id)?.alerts[0] : undefined;
    return a && locs.length > 1 ? ` at ${locs.find((l) => l.id === a.locationId)?.name.replace(`${business.name} - `, "") ?? "a location"}` : "";
  };

  // A list entry is a product on its own, or a product with options (its options folded under it).
  type Entry = { key: string; category: string; single?: Row; group?: { id: string; name: string; options: Row[] } };
  const entries: Entry[] = [];
  const byGroup = new Map<string, Entry>();
  for (const r of rows) {
    const category = r.category ?? "Uncategorised";
    if (!r.p.groupId) {
      entries.push({ key: r.p.id, category, single: r });
      continue;
    }
    let e = byGroup.get(r.p.groupId);
    if (!e) {
      e = { key: r.p.groupId, category, group: { id: r.p.groupId, name: r.p.name, options: [] } };
      byGroup.set(r.p.groupId, e);
      entries.push(e);
    }
    e.group!.options.push(r);
  }
  const byCategory = new Map<string, Entry[]>();
  for (const e of entries) byCategory.set(e.category, [...(byCategory.get(e.category) ?? []), e]);

  const stockChip = (id: string, qty: number) => {
    const it = standing.get(id);
    const st = it?.status ?? "ok";
    return <span className={`ml-2 whitespace-nowrap rounded px-1.5 py-0.5 text-[11px] font-medium ${st === "negative" || st === "out" ? "bg-red-50 text-red-700" : st === "low" ? "bg-amber-50 text-amber-800" : "bg-stone-100 text-stone-600"}`}>{st === "negative" ? `Count is off${where(id)}` : st === "out" ? `Out of stock${where(id)}` : st === "low" && where(id) ? `Low${where(id)} · ${qty} in all` : `${qty} in stock`}</span>;
  };

  return (
    <>
      <PageHeader title="Products">
        {manage ? <LinkButton href={`/app/${slug}/products/categories`}>Categories</LinkButton> : null}
        {manage && allRows.length ? <LinkButton href={`/app/${slug}/products/bulk`}><Pencil className="h-4 w-4" /> Edit all</LinkButton> : null}
        {manage ? <LinkButton href={`/app/${slug}/products/import`}><Upload className="h-4 w-4" /> Import</LinkButton> : null}
        {allRows.length ? <LinkButton href={`/app/${slug}/products/export`}><Download className="h-4 w-4" /> Export</LinkButton> : null}
        {manage ? <LinkButton href={`/app/${slug}/products/new`} variant="primary"><Plus className="h-4 w-4" /> New product</LinkButton> : null}
      </PageHeader>
      {allRows.length ? (
        <AutoSubmitForm className="mb-4 flex flex-wrap items-center gap-2">
          <div className="relative min-w-[14rem] flex-1 sm:max-w-sm">
            <Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-stone-400" aria-hidden />
            <Input name="q" defaultValue={sp.q ?? ""} placeholder="Search name, SKU, barcode or category" aria-label="Search products" autoComplete="off" className="pl-9" />
          </div>
          <Select name="show" defaultValue={show} aria-label="Show" className="h-10 w-auto">
            <option value="">All products</option>
            <option value="attention">Out, low or off</option>
            <option value="backbar">Back-bar only</option>
            <option value="hidden">Hidden only</option>
          </Select>
          {filtering ? <Link href={`/app/${slug}/products`} className="text-sm text-stone-600 underline">Clear</Link> : null}
          {filtering ? <span className="text-sm text-stone-500">{rows.length} of {allRows.length} products</span> : null}
        </AutoSubmitForm>
      ) : null}
      <div className="space-y-4">
        {allRows.length === 0 ? <Empty title="No retail products yet" body="Shampoo, styling products, gift items…" action={{ href: `/app/${slug}/products/new`, label: "Add a product" }} /> : null}
        {allRows.length > 0 && rows.length === 0 ? <Empty title="No product matches" body={q ? `Nothing matches “${sp.q}”${show ? " with that filter" : ""}. Try part of the name, or a barcode.` : "Nothing fits that filter."} /> : null}
        {[...byCategory.entries()].map(([cat, list]) => (
          <Card key={cat}>
            <h2 className="border-b border-stone-200 px-4 py-2 text-sm font-semibold text-stone-600">{cat}</h2>
            <ul className="divide-y divide-stone-200">
              {list.map((e) => {
                if (e.single) {
                  const { p } = e.single;
                  return (
                    <li key={e.key} className={`flex items-center gap-3 px-4 py-3 ${canOpen ? rowClass : ""}`}>
                      <Thumb src={p.imageUrl} />
                      <div className="min-w-0 flex-1">
                        {canOpen ? <RowLink href={`/app/${slug}/products/${p.id}`} className={`font-medium ${p.active ? "" : "text-stone-400 line-through"}`}>{productLabel(p)}</RowLink> : <p className={p.active ? "font-medium" : "font-medium text-stone-400 line-through"}>{productLabel(p)}</p>}
                        <p className="text-xs text-stone-500">{[p.kind === "backbar" ? "back-bar (not sold)" : null, p.sku, p.barcode, p.kind === "backbar" ? null : p.taxable ? "taxable" : "tax-free", p.sellOnline ? "online" : null].filter(Boolean).join(" · ")}{p.trackStock ? stockChip(p.id, p.stockQty) : null}</p>
                      </div>
                      <span className="w-28 shrink-0 text-right font-medium tabular-nums">{p.kind === "backbar" ? <span className="text-stone-400">—</span> : money(p.priceCents)}</span>
                      {manage ? (
                        <form action={toggleProductActive} className={rowControl}>
                          <input type="hidden" name="slug" value={slug} />
                          <input type="hidden" name="productId" value={p.id} />
                          <input type="hidden" name="active" value={p.active ? "false" : "true"} />
                          <Button size="sm" variant="ghost" type="submit">{p.active ? "Hide" : "Show"}</Button>
                        </form>
                      ) : null}
                    </li>
                  );
                }
                const g = e.group!;
                const first = g.options[0]!.p;
                const sum = groupSummary(g.options.map(({ p }) => ({ priceCents: p.priceCents, stockQty: p.stockQty, status: standing.get(p.id)?.status ?? "ok", tracked: p.trackStock, active: p.active })));
                const groupActive = g.options.some(({ p }) => p.active);
                return (
                  <li key={e.key}>
                    <details className="group" open={filtering || undefined}>
                      <summary className={`flex cursor-pointer list-none items-center gap-3 px-4 py-3 marker:content-none [&::-webkit-details-marker]:hidden ${canOpen ? rowClass : ""}`}>
                        <span className="relative z-10 -m-2 shrink-0 cursor-pointer p-2" title="Show the options"><ChevronRight className="h-4 w-4 text-stone-400 transition-transform group-open:rotate-90" aria-hidden /></span>
                        <Thumb src={first.imageUrl} />
                        <div className="min-w-0 flex-1">
                          {canOpen ? <RowLink href={`/app/${slug}/products/group/${g.id}`} className={`font-medium ${groupActive ? "" : "text-stone-400 line-through"}`}>{g.name}</RowLink> : <p className="font-medium">{g.name}</p>}
                          <p className="text-xs text-stone-500">
                            {sum.options} option{sum.options === 1 ? "" : "s"}{first.kind === "backbar" ? " · back-bar (not sold)" : ""}{first.sellOnline ? " · online" : ""}
                            {sum.anyTracked ? <span className={`ml-2 whitespace-nowrap rounded px-1.5 py-0.5 text-[11px] font-medium ${sum.worst === "negative" || sum.worst === "out" ? "bg-red-50 text-red-700" : sum.worst === "low" ? "bg-amber-50 text-amber-800" : "bg-stone-100 text-stone-600"}`}>{sum.worst === "negative" ? "Count is off" : sum.worst === "out" ? "An option is out" : sum.worst === "low" ? "An option is low" : `${sum.totalStock} in stock`}</span> : null}
                          </p>
                        </div>
                        <span className="w-36 shrink-0 whitespace-nowrap text-right font-medium tabular-nums">{first.kind === "backbar" ? <span className="text-stone-400">—</span> : priceRange(sum.minPrice, sum.maxPrice, money)}</span>
                        {manage ? (
                          <form action={toggleGroupActive} className={rowControl}>
                            <input type="hidden" name="slug" value={slug} />
                            <input type="hidden" name="groupId" value={g.id} />
                            <input type="hidden" name="active" value={groupActive ? "false" : "true"} />
                            <Button size="sm" variant="ghost" type="submit">{groupActive ? "Hide" : "Show"}</Button>
                          </form>
                        ) : null}
                      </summary>
                      <ul className="divide-y divide-stone-100 border-t border-stone-100 bg-stone-50/60">
                        {g.options.map(({ p }) => (
                          <li key={p.id} className={`flex items-center gap-3 py-2 pl-14 pr-4 ${canOpen ? rowClass : ""}`}>
                            <div className="min-w-0 flex-1">
                              {canOpen ? <RowLink href={`/app/${slug}/products/${p.id}`} className={`text-sm ${p.active ? "" : "text-stone-400 line-through"}`}>{p.variantLabel}</RowLink> : <p className="text-sm">{p.variantLabel}</p>}
                              <p className="text-xs text-stone-500">{[p.sku, p.barcode].filter(Boolean).join(" · ")}{p.trackStock ? stockChip(p.id, p.stockQty) : null}</p>
                            </div>
                            <span className="w-28 shrink-0 text-right text-sm tabular-nums">{p.kind === "backbar" ? <span className="text-stone-400">—</span> : money(p.priceCents)}</span>
                            {manage ? <span className="w-[4.5rem] shrink-0" /> : null}
                          </li>
                        ))}
                      </ul>
                    </details>
                  </li>
                );
              })}
            </ul>
          </Card>
        ))}
      </div>
    </>
  );
}
