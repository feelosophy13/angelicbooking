import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { can } from "@angelic/core";
import { requireAction, requireBusiness } from "@/lib/tenant";
import { listCategories } from "@/server/categories";
import { listSuppliers } from "@/server/inventory";
import { getGroup } from "@/server/product-groups";
import { groupSummary, priceRange } from "@/lib/variants";
import { productLabel, stockStatus } from "@/lib/inventory";
import { formatMoney } from "@/lib/utils";
import { BackLink, Button, Card, MoneyInput, PageHeader, Textarea } from "@/components/ui";
import { ActionForm, Field, SubmitButton } from "@/components/form";
import { CategoryPicker } from "@/components/categories";
import { rowClass, RowLink } from "@/components/row";
import { Thumb } from "@/components/thumb";
import { addGroupOptions, saveGroup, toggleGroupActive } from "../../actions";
import { GroupSharedFields } from "./shared-fields";

export const metadata: Metadata = { title: "Product options" };

/** One product that comes in options: what they share (changes apply to every option), and the options themselves. */
export default async function ProductGroupPage({ params }: { params: Promise<{ slug: string; groupId: string }> }) {
  const { slug, groupId } = await params;
  const { business, permissions } = await requireBusiness(slug);
  const canEdit = can(permissions, "services.manage");
  if (!canEdit && !can(permissions, "inventory.manage")) await requireAction(slug, "services.manage");
  const data = await getGroup(business.id, groupId);
  if (!data) notFound();
  const { group, options } = data;
  const [categories, suppliers] = await Promise.all([listCategories(business.id, "product"), listSuppliers(business.id)]);
  const money = (c: number) => formatMoney(c, business.currency);
  const sum = groupSummary(options.map((o) => ({ priceCents: o.priceCents, stockQty: o.stockQty, status: stockStatus(o.stockQty, o.lowStockThreshold), tracked: o.trackStock, active: o.active })));

  return (
    <>
      <div className="mb-2"><BackLink href={`/app/${slug}/products`}>Products</BackLink></div>
      <PageHeader title={group.name}>
        {canEdit ? (
          <form action={toggleGroupActive}>
            <input type="hidden" name="slug" value={slug} />
            <input type="hidden" name="groupId" value={group.id} />
            <input type="hidden" name="active" value={group.active ? "false" : "true"} />
            <Button type="submit" variant="secondary" size="sm">{group.active ? "Hide all options" : "Show all options"}</Button>
          </form>
        ) : null}
      </PageHeader>
      <p className="mb-4 text-sm text-stone-600">
        {sum.options} option{sum.options === 1 ? "" : "s"}
        {group.kind === "retail" ? ` · ${priceRange(sum.minPrice, sum.maxPrice, money)}` : " · back-bar"}
        {sum.anyTracked ? ` · ${sum.totalStock} in stock across them` : ""}
      </p>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_24rem]">
        <div className="min-w-0 space-y-5">
          <Card>
            <div className="flex items-center justify-between border-b border-stone-200 px-4 py-2">
              <h2 className="text-sm font-semibold text-stone-600">Options</h2>
              <span className="text-xs text-stone-500">Click an option for its price, barcode and stock</span>
            </div>
            <ul className="divide-y divide-stone-100">
              {options.map((o) => {
                const st = stockStatus(o.stockQty, o.lowStockThreshold);
                return (
                  <li key={o.id} className={`${rowClass} flex items-center gap-3 px-4 py-2.5`}>
                    <Thumb src={o.imageUrl} />
                    <div className="min-w-0 flex-1">
                      <RowLink href={`/app/${slug}/products/${o.id}`} className={`font-medium ${o.active ? "" : "text-stone-400 line-through"}`}>{o.variantLabel}</RowLink>
                      <p className="truncate text-xs text-stone-500">{[o.sku, o.barcode].filter(Boolean).join(" · ") || "No SKU or barcode yet"}{o.imageUrl && o.imageUrl !== group.imageUrl ? " · own photo" : ""}</p>
                    </div>
                    {o.trackStock ? <span className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${st === "negative" || st === "out" ? "bg-red-50 text-red-700" : st === "low" ? "bg-amber-50 text-amber-800" : "bg-stone-100 text-stone-600"}`}>{st === "negative" ? "Count is off" : st === "out" ? "Out" : `${o.stockQty} in stock`}</span> : null}
                    <span className="w-20 shrink-0 text-right font-medium tabular-nums">{group.kind === "backbar" ? <span className="text-stone-400">—</span> : money(o.priceCents)}</span>
                  </li>
                );
              })}
            </ul>
          </Card>

          {canEdit ? (
            <Card className="p-4">
              <h2 className="mb-1 text-sm font-semibold text-stone-700">Add options</h2>
              <p className="mb-3 text-xs text-stone-500">One per line (or separated by commas). Add a second list to make every combination, like shades in two sizes. Options it already has are skipped. A new option's price and cost are the ones below, or the first option's if you leave them blank.</p>
              <ActionForm action={addGroupOptions}>
                <input type="hidden" name="slug" value={slug} />
                <input type="hidden" name="groupId" value={group.id} />
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Options" name="options"><Textarea name="options" rows={5} placeholder={"7N\n8N\n9N"} /></Field>
                  <Field label="A second kind (optional)" name="options2"><Textarea name="options2" rows={5} placeholder={"50 ml\n100 ml"} /></Field>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  {group.kind === "retail" ? <Field label="Price" name="price"><MoneyInput name="price" currency={business.currency} placeholder={options[0] ? (options[0].priceCents / 100).toFixed(2) : "0.00"} /></Field> : null}
                  <Field label="Cost" name="cost"><MoneyInput name="cost" currency={business.currency} placeholder={options[0]?.costCents ? (options[0].costCents / 100).toFixed(2) : "0.00"} /></Field>
                </div>
                <SubmitButton variant="secondary" pendingText="Adding…">Add options</SubmitButton>
              </ActionForm>
            </Card>
          ) : null}
        </div>

        {canEdit ? (
          <Card className="h-fit p-4">
            <h2 className="mb-1 text-sm font-semibold text-stone-700">Shared by every option</h2>
            <p className="mb-3 text-xs text-stone-500">Change these once and every option follows.</p>
            <ActionForm action={saveGroup}>
              <input type="hidden" name="slug" value={slug} />
              <input type="hidden" name="groupId" value={group.id} />
              <GroupSharedFields group={group} category={<CategoryPicker name="categoryId" categories={categories} value={group.categoryId} />} suppliers={suppliers} storeOn={business.storeEnabled} slug={slug} />
              <SubmitButton pendingText="Saving…">Save for every option</SubmitButton>
            </ActionForm>
          </Card>
        ) : (
          <p className="text-sm text-stone-500"><Link href={`/app/${slug}/inventory`} className="underline">Back to inventory</Link></p>
        )}
      </div>
    </>
  );
}
