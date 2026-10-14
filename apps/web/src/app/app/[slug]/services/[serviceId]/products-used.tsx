import Link from "next/link";
import { and, asc, eq } from "drizzle-orm";
import { schema, withTenant } from "@angelic/db";
import { serviceUsage, stockOverview } from "@/server/inventory";
import { serviceTree } from "@/server/service-groups";
import { productLabel } from "@/lib/inventory";
import { Button, Card, Input, Select } from "@/components/ui";
import { AutoSaveForm } from "@/components/auto-save-form";
import { ProductPicker } from "@/components/product-picker";
import { Disclosure } from "@/components/disclosure";
import { ServiceCheckboxes } from "@/components/service-checkboxes";
import { copyServiceProducts, setServiceProduct } from "../actions";

type Row = Awaited<ReturnType<typeof serviceUsage>>[number];

const GROUPS = [
  { mode: "auto", title: "Taken off at checkout", amountLabel: "Units per visit", blurb: "Comes off the stock by itself when the service is rung up. For things used up in a fixed amount every visit: sheets, applicators.", other: "log" },
  { mode: "log", title: "Staff log these on the appointment", amountLabel: "Usually", blurb: "Staff record what they really used. The number is only a suggestion. For things used unevenly: color, adhesive.", other: "auto" },
] as const;

/**
 * What a visit of this service uses up. Two lists: what the sale takes off by itself, and what staff are asked to log on the appointment.
 * Every change saves as it is made. A list can be copied to other services.
 */
export async function ProductsUsed({ slug, businessId, serviceId }: { slug: string; businessId: string; serviceId: string }) {
  const [used, products, overview, tree] = await Promise.all([
    serviceUsage(businessId, serviceId),
    withTenant(businessId, (tx) =>
      tx
        .select({ id: schema.products.id, name: schema.products.name, variantLabel: schema.products.variantLabel, kind: schema.products.kind, category: schema.productCategories.name })
        .from(schema.products)
        .leftJoin(schema.productCategories, eq(schema.productCategories.id, schema.products.categoryId))
        .where(and(eq(schema.products.active, true)))
        .orderBy(asc(schema.productCategories.sortOrder), asc(schema.productCategories.name), asc(schema.products.name), asc(schema.products.variantLabel)),
    ),
    stockOverview(businessId),
    serviceTree({ id: businessId }),
  ]);
  const stock = new Map(overview.items.map((i) => [i.id, i]));
  const have = new Set(used.map((u) => u.productId));
  const choices = products.filter((p) => !have.has(p.id));
  const sorted = [...used].sort((a, b) => productLabel(a).localeCompare(productLabel(b)));
  const names = (mode: string) => sorted.filter((u) => u.mode === mode).map((u) => (mode === "auto" ? `${u.quantity} ${productLabel(u)}` : productLabel(u)));
  const auto = names("auto");
  const log = names("log");

  return (
    <Card className="mt-5 max-w-2xl p-5">
      <h2 className="font-medium">Products used</h2>
      <p className="mb-3 text-sm text-stone-500">
        {used.length
          ? [auto.length ? `At checkout: ${auto.join(", ")}.` : null, log.length ? `Staff log: ${log.join(", ")}.` : null].filter(Boolean).join(" ")
          : "Nothing yet. Add what a visit of this service uses up so the stock follows the work."}
      </p>

      {GROUPS.map((g) => {
        const rows = sorted.filter((u) => u.mode === g.mode);
        if (!rows.length) return null;
        return (
          <section key={g.mode} className="mb-4">
            <h3 className="text-sm font-medium text-stone-800">{g.title}</h3>
            <p className="mb-1 text-xs text-stone-500">{g.blurb}</p>
            <ul className="divide-y divide-stone-100 border-y border-stone-100">
              {rows.map((u) => <UsageRow key={u.id} u={u} slug={slug} serviceId={serviceId} group={g} item={stock.get(u.productId)} />)}
            </ul>
          </section>
        );
      })}

      <form action={setServiceProduct} className="space-y-2">
        <input type="hidden" name="slug" value={slug} />
        <input type="hidden" name="serviceId" value={serviceId} />
        <p className="text-sm font-medium text-stone-800">Add a product</p>
        {choices.length ? (
          <div className="flex flex-wrap items-center gap-2">
            <div className="min-w-[14rem] flex-1"><ProductPicker name="productId" products={choices} placeholder="Find a product…" /></div>
            <Select name="mode" defaultValue="auto" aria-label="How it is counted" className="w-full sm:w-52"><option value="auto">Taken off at checkout</option><option value="log">Staff log it</option></Select>
            <Input name="quantity" type="number" min={1} defaultValue={1} aria-label="Units per visit" className="w-20 text-right" />
            <Button type="submit" size="sm" variant="secondary">Add</Button>
          </div>
        ) : <p className="text-xs text-stone-500">Every product is already on this list.</p>}
      </form>

      {used.length ? (
        <Disclosure title="Copy this list to other services" hint="same products, one step" className="mt-4">
          <form action={copyServiceProducts} className="space-y-3">
            <input type="hidden" name="slug" value={slug} />
            <input type="hidden" name="fromServiceId" value={serviceId} />
            <ServiceCheckboxes name="serviceId" tree={tree} selected={[]} />
            <fieldset className="space-y-1 text-sm">
              <label className="flex items-start gap-2"><input type="radio" name="how" value="add" defaultChecked className="mt-1" /><span>Add what's missing, keep what they already have</span></label>
              <label className="flex items-start gap-2"><input type="radio" name="how" value="replace" className="mt-1" /><span>Replace their lists with this one</span></label>
            </fieldset>
            <Button type="submit" size="sm" variant="secondary">Copy</Button>
          </form>
        </Disclosure>
      ) : null}
    </Card>
  );
}

function UsageRow({ u, slug, serviceId, group, item }: { u: Row; slug: string; serviceId: string; group: (typeof GROUPS)[number]; item: Awaited<ReturnType<typeof stockOverview>>["items"][number] | undefined }) {
  const label = productLabel(u);
  const status = item?.status ?? "ok";
  return (
    <li>
      <AutoSaveForm action={setServiceProduct} className="grid items-center gap-x-3 gap-y-1.5 py-2 sm:grid-cols-[minmax(0,1fr)_auto]">
        <input type="hidden" name="slug" value={slug} />
        <input type="hidden" name="serviceId" value={serviceId} />
        <input type="hidden" name="productId" value={u.productId} />
        <input type="hidden" name="mode" value={u.mode} />
        <div className="min-w-0 text-sm">
          <Link href={`/app/${slug}/products/${u.productId}`} className="font-medium hover:underline">{label}</Link>
          {u.kind === "retail" ? <span className="ml-1.5 whitespace-nowrap rounded bg-sky-50 px-1.5 py-0.5 text-[11px] font-medium text-sky-800">also sold</span> : null}
          {item ? <span className={`ml-1.5 whitespace-nowrap rounded px-1.5 py-0.5 text-[11px] font-medium ${status === "ok" ? "bg-stone-100 text-stone-600" : status === "low" ? "bg-amber-50 text-amber-800" : "bg-red-50 text-red-700"}`}>{status === "negative" ? "count is off" : status === "out" ? "out of stock" : status === "low" ? `low · ${item.stockQty} left` : `${item.stockQty} on hand`}</span> : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-1.5 text-xs text-stone-500">
            {group.amountLabel}
            <Input name="quantity" type="number" min={1} defaultValue={u.quantity} aria-label={`${group.amountLabel}: ${label}`} className="h-9 w-16 text-right" />
          </label>
          <Button type="submit" size="sm" variant="ghost" name="mode" value={group.other} title={group.other === "log" ? "Have staff log it on the appointment instead" : "Take it off at checkout instead"}>{group.other === "log" ? "Staff log it instead" : "Take off at checkout instead"}</Button>
          <Button type="submit" size="sm" variant="ghost" name="remove" value="1" className="text-stone-500 hover:text-red-600">Remove</Button>
        </div>
      </AutoSaveForm>
    </li>
  );
}
