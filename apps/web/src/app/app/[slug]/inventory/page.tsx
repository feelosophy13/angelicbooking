import Link from "next/link";
import { redirect } from "next/navigation";
import { Download, PackagePlus, Search, Upload } from "lucide-react";
import { requireAnyAction } from "@/lib/tenant";
import { can } from "@angelic/core";
import { canSeeCosts } from "@/lib/visibility";
import { formatMoney } from "@/lib/utils";
import { findProductByCode, listLocations, stockOverview } from "@/server/inventory";
import { productLabel } from "@/lib/inventory";
import { Card, Empty, Input, LinkButton, Select } from "@/components/ui";
import { AutoSubmitForm } from "@/components/auto-submit-form";
import { rowClass, RowLink } from "@/components/row";

type SP = { q?: string; show?: string; loc?: string };

const BADGE = {
  negative: ["Count is off", "bg-red-50 text-red-700"],
  out: ["Out of stock", "bg-red-50 text-red-700"],
  low: ["Low", "bg-amber-50 text-amber-800"],
  ok: ["", ""],
} as const;

export default async function InventoryStockPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<SP> }) {
  const { slug } = await params;
  const sp = await searchParams;
  // Stock levels are readable with "See stock levels"; receiving, importing and the cost figures each need their own permission.
  const { business, permissions } = await requireAnyAction(slug, "inventory.manage", "inventory.view");
  const manage = can(permissions, "inventory.manage");
  const costs = canSeeCosts(permissions);
  const base = `/app/${slug}/inventory`;
  // A scanned or typed barcode / SKU that matches exactly goes straight to the product.
  const q = (sp.q ?? "").trim();
  if (q) {
    const hit = await findProductByCode(business.id, q);
    if (hit) redirect(`/app/${slug}/products/${hit.id}`);
  }
  const [{ items, untracked }, locations] = await Promise.all([stockOverview(business.id), listLocations(business.id)]);
  const multi = locations.length > 1;
  const loc = multi && locations.some((l) => l.id === sp.loc) ? sp.loc! : "";
  const short = (name: string) => name.replace(`${business.name} - `, "");
  const money = (c: number) => formatMoney(c, business.currency);
  const needle = q.toLowerCase();
  const shown = items
    .filter((i) => !needle || [productLabel(i), i.sku, i.barcode, i.category, i.supplierName].some((v) => v?.toLowerCase().includes(needle)))
    .filter((i) => (sp.show === "attention" ? standing(i) !== "ok" : true));
  const qtyOf = (i: (typeof items)[number]) => (loc ? (i.byLocation[loc] ?? 0) : i.stockQty);
  // With a location chosen, standing is that location's; otherwise the worst anywhere.
  const standing = (i: (typeof items)[number]) => (loc ? (i.alerts.find((a) => a.locationId === loc)?.status ?? "ok") : i.status);
  const attention = items.filter((i) => standing(i) !== "ok").length;
  const totalValue = items.reduce((s, i) => s + i.valueCents, 0);
  const totalRetail = items.reduce((s, i) => s + i.retailCents, 0);

  if (!items.length && !untracked) {
    return <Empty title="No products yet" body="Add products first, then track their stock here." action={{ href: `/app/${slug}/products/new`, label: "Add a product" }} />;
  }
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <AutoSubmitForm className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-stone-400" aria-hidden />
            <Input name="q" defaultValue={q} placeholder="Search, or scan a barcode" aria-label="Search or scan a barcode" className="w-64 pl-8" autoComplete="off" />
          </div>
          {multi ? (
            <Select name="loc" defaultValue={loc} aria-label="Location" className="h-9 w-auto">
              <option value="">All locations</option>
              {locations.map((l) => <option key={l.id} value={l.id}>{short(l.name)}</option>)}
            </Select>
          ) : null}
          <Select name="show" defaultValue={sp.show ?? ""} aria-label="Show" className="h-9 w-auto">
            <option value="">Everything</option>
            <option value="attention">Needs attention ({attention})</option>
          </Select>
        </AutoSubmitForm>
        {manage ? <div className="ml-auto flex flex-wrap gap-2">
          <LinkButton href={`${base}/receive`} variant="primary" size="sm"><PackagePlus className="h-4 w-4" /> Receive stock</LinkButton>
          <LinkButton href={`/app/${slug}/products/import`} size="sm"><Upload className="h-4 w-4" /> Import</LinkButton>
          {costs ? <LinkButton href={`/app/${slug}/products/export`} size="sm"><Download className="h-4 w-4" /> Export</LinkButton> : null}
        </div> : null}
      </div>

      <Card className={`grid grid-cols-2 divide-x divide-stone-100 text-sm ${costs ? "sm:grid-cols-4" : "sm:grid-cols-3"}`}>
        <Stat label="Products tracked" value={String(items.length)} />
        <Stat label="Need attention" value={String(attention)} tone={attention ? "text-amber-700" : undefined} />
        {costs ? <Stat label="Value at cost" value={money(totalValue)} /> : null}
        <Stat label="Value at retail" value={money(totalRetail)} />
      </Card>

      {shown.length === 0 ? (
        <Empty title={items.length ? "Nothing matches" : "No stock tracked yet"} body={items.length ? "Try a different search." : "Turn on Track stock for a product, or import a spreadsheet with an On hand column."} />
      ) : (
        <Card>
          <ul className="divide-y divide-stone-100">
            {shown.map((i, idx) => {
              const qty = qtyOf(i);
              // A product with options gets a small heading above its options, with what they add up to.
              const opts = i.groupId ? shown.filter((x) => x.groupId === i.groupId) : [];
              const heading = i.groupId && shown[idx - 1]?.groupId !== i.groupId ? (
                <li key={`h-${i.groupId}`} className="flex items-center justify-between gap-3 bg-stone-50 px-4 py-1.5 text-xs font-semibold text-stone-600">
                  <Link href={`/app/${slug}/products/group/${i.groupId}`} className="hover:underline">{i.name}</Link>
                  <span className="font-normal text-stone-500">{opts.length} option{opts.length === 1 ? "" : "s"} · {opts.reduce((a, x) => a + qtyOf(x), 0)} in all</span>
                </li>
              ) : null;
              const [badgeText, badgeCls] = BADGE[standing(i)];
              return [heading, (
                <li key={i.id} className={`${rowClass} flex items-center gap-3 px-4 py-2.5`}>
                  <div className="min-w-0 flex-1">
                    <RowLink href={`/app/${slug}/products/${i.id}`} className="font-medium">{productLabel(i)}</RowLink>
                    <p className="truncate text-xs text-stone-500">
                      {[i.category, i.kind === "backbar" ? "back-bar" : null, i.sku, i.supplierName].filter(Boolean).join(" · ")}
                    </p>
                    {multi && !loc ? (
                      <p className="flex flex-wrap gap-x-3 text-xs">
                        {locations.filter((l) => i.byLocation[l.id] != null).map((l) => {
                          const a = i.alerts.find((x) => x.locationId === l.id);
                          return <span key={l.id} className={a ? (a.status === "low" ? "font-medium text-amber-700" : "font-medium text-red-700") : "text-stone-500"}>{short(l.name)} {i.byLocation[l.id]}{a ? (a.status === "negative" ? " (count is off)" : a.status === "out" ? " (out)" : " (low)") : ""}</span>;
                        })}
                      </p>
                    ) : null}
                  </div>
                  {badgeText ? <span className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${badgeCls}`}>{badgeText}</span> : null}
                  {i.onOrder ? <Link href={`${base}/orders`} className="relative z-10 text-xs text-brand-700 underline">{i.onOrder} on order</Link> : null}
                  <span className="w-14 shrink-0 text-right text-xs text-stone-500">low at {i.lowStockThreshold}</span>
                  <span className={`w-14 shrink-0 text-right text-base font-semibold tabular-nums ${qty < 0 ? "text-red-700" : ""}`}>{qty}</span>
                  {costs ? <span className="hidden w-24 shrink-0 text-right text-sm text-stone-600 tabular-nums sm:block">{i.costCents ? money(qty * i.costCents) : "—"}</span> : null}
                </li>
              )];
            })}
          </ul>
        </Card>
      )}
      {untracked ? <p className="text-xs text-stone-500">{untracked} active product{untracked === 1 ? " isn't" : "s aren't"} tracked. Open a product and receive or count some stock, or turn on Track stock, to include {untracked === 1 ? "it" : "them"}.</p> : null}
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="px-4 py-3">
      <p className="text-xs text-stone-500">{label}</p>
      <p className={`text-lg font-semibold ${tone ?? ""}`}>{value}</p>
    </div>
  );
}
