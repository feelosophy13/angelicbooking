import type { Metadata } from "next";
import { requireAction } from "@/lib/tenant";
import { listAllProducts, listSuppliers } from "@/server/inventory";
import { productLabel } from "@/lib/inventory";
import { FormPage, Input, MoneyInput, Select } from "@/components/ui";
import { ActionForm, SubmitButton } from "@/components/form";
import { saveBulk } from "./actions";

export const metadata: Metadata = { title: "Edit all products" };

/** Every product in one table: prices, costs, stock levels and supplier changed together instead of one page at a time. */
export default async function BulkProductsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { business } = await requireAction(slug, "services.manage");
  const [products, suppliers] = await Promise.all([listAllProducts(business.id), listSuppliers(business.id)]);
  const money = (c: number) => (c ? (c / 100).toFixed(2) : "");
  return (
    <FormPage title="Edit all products" backHref={`/app/${slug}/products`} backLabel="Products" width="max-w-6xl">
      <p className="mb-3 text-sm text-stone-600">Change what you need and save once. Counts are not here: use Stock count or each product to change those.</p>
      <ActionForm action={saveBulk}>
        <input type="hidden" name="slug" value={slug} />
        <div className="overflow-x-auto">
          <table className="w-full min-w-[56rem] text-sm">
            <thead className="text-left text-xs text-stone-500">
              <tr><th className="py-1 pr-2">Product</th><th className="py-1 pr-2">Price</th><th className="py-1 pr-2">Cost</th><th className="py-1 pr-2">Low at</th><th className="py-1 pr-2">Order up to</th><th className="py-1 pr-2">Supplier</th><th className="py-1 pr-2 text-center">Shown</th></tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {products.map((p) => (
                <tr key={p.id}>
                  <td className="py-1.5 pr-2"><input type="hidden" name="id" value={p.id} /><span className={p.active ? "font-medium" : "text-stone-400 line-through"}>{productLabel(p)}</span>{p.kind === "backbar" ? <span className="ml-1 text-xs text-stone-500">back-bar</span> : null}</td>
                  <td className="w-28 py-1.5 pr-2">{p.kind === "backbar" ? <span className="text-stone-400">—</span> : <MoneyInput name={`price:${p.id}`} currency={business.currency} defaultValue={money(p.priceCents)} aria-label={`Price of ${productLabel(p)}`} />}</td>
                  <td className="w-28 py-1.5 pr-2"><MoneyInput name={`cost:${p.id}`} currency={business.currency} defaultValue={money(p.costCents)} aria-label={`Cost of ${productLabel(p)}`} /></td>
                  <td className="w-20 py-1.5 pr-2"><Input name={`low:${p.id}`} type="number" min={0} defaultValue={p.lowStockThreshold} aria-label={`Low-stock level of ${productLabel(p)}`} /></td>
                  <td className="w-24 py-1.5 pr-2"><Input name={`upto:${p.id}`} type="number" min={0} defaultValue={p.reorderUpTo ?? ""} aria-label={`Order up to for ${productLabel(p)}`} /></td>
                  <td className="w-44 py-1.5 pr-2"><Select name={`supplier:${p.id}`} defaultValue={p.supplierId ?? ""} aria-label={`Supplier of ${productLabel(p)}`}><option value="">None</option>{suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select></td>
                  <td className="py-1.5 pr-2 text-center"><input type="checkbox" name={`active:${p.id}`} defaultChecked={p.active} aria-label={`${productLabel(p)} is shown`} className="h-4 w-4" /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <SubmitButton pendingText="Saving…">Save all</SubmitButton>
      </ActionForm>
    </FormPage>
  );
}
