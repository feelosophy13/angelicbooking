import type { Metadata } from "next";
import { requireAction } from "@/lib/tenant";
import { listLocations, scannableProducts, stockOverview } from "@/server/inventory";
import { listCategories } from "@/server/categories";
import { Disclosure } from "@/components/disclosure";
import { ScanSession } from "../scan-session";
import { productLabel } from "@/lib/inventory";
import { BackLink, Card, Input, Select } from "@/components/ui";
import { ActionForm, Field, SubmitButton } from "@/components/form";
import { AutoSubmitForm } from "@/components/auto-submit-form";
import { receiveStock } from "../actions";

export const metadata: Metadata = { title: "Receive stock" };

/** A delivery that did not come with an order: type how many of each product arrived. (Deliveries against an order are received on the order.) */
export default async function ReceivePage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ supplier?: string; q?: string }> }) {
  const { slug } = await params;
  const sp = await searchParams;
  const { business } = await requireAction(slug, "inventory.manage");
  const [{ items }, locations, scannable, categories] = await Promise.all([stockOverview(business.id), listLocations(business.id), scannableProducts(business.id), listCategories(business.id, "product")]);
  const short = (n: string) => n.replace(`${business.name} - `, "");
  const suppliers = [...new Map(items.filter((i) => i.supplierId).map((i) => [i.supplierId!, i.supplierName!])).entries()];
  const needle = (sp.q ?? "").toLowerCase();
  const shown = items.filter((i) => (!sp.supplier || i.supplierId === sp.supplier) && (!needle || [productLabel(i), i.sku, i.barcode].some((v) => v?.toLowerCase().includes(needle))));
  return (
    <div className="space-y-3">
      <BackLink href={`/app/${slug}/inventory`}>Stock</BackLink>
      <p className="text-sm text-stone-600">Point the scanner at each item as it comes out of the box. Scan the same product again for each unit. Nothing is added until you press the button at the bottom.</p>
      <ScanSession slug={slug} mode="receive" products={scannable} categories={categories.map((c) => ({ id: c.id, name: c.name }))} locations={locations.map((l) => ({ id: l.id, name: short(l.name) }))} defaultLocationId={locations.find((l) => l.isDefault)?.id ?? locations[0]!.id} />
      <Disclosure title="Type quantities instead" hint="no scanner, or a long delivery of a few products" className="mt-2">
      <div className="space-y-3">
      <AutoSubmitForm className="flex flex-wrap items-center gap-2">
        <Input name="q" defaultValue={sp.q ?? ""} placeholder="Find a product, or scan" aria-label="Find a product" className="w-64" autoComplete="off" />
        {suppliers.length ? (
          <Select name="supplier" defaultValue={sp.supplier ?? ""} aria-label="Supplier" className="h-9 w-auto">
            <option value="">All suppliers</option>
            {suppliers.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
          </Select>
        ) : null}
      </AutoSubmitForm>
      <Card className="p-4">
        <ActionForm action={receiveStock}>
          <input type="hidden" name="slug" value={slug} />
          <div className="grid gap-3 sm:grid-cols-2">
            {locations.length > 1 ? (
              <Field label="Delivered to" name="locationId"><Select name="locationId" defaultValue={locations.find((l) => l.isDefault)?.id}>{locations.map((l) => <option key={l.id} value={l.id}>{l.name.replace(`${business.name} - `, "")}</option>)}</Select></Field>
            ) : null}
            <Field label="Note" name="note" hint="Invoice number, delivery date…"><Input name="note" /></Field>
          </div>
          {shown.length === 0 ? <p className="text-sm text-stone-500">No tracked products match.</p> : (
            <ul className="divide-y divide-stone-100">
              {shown.map((i) => (
                <li key={i.id} className="flex items-center gap-3 py-1.5">
                  <label htmlFor={`qty:${i.id}`} className="min-w-0 flex-1 truncate text-sm">{productLabel(i)} <span className="text-xs text-stone-500">· {i.stockQty} on hand{i.onOrder ? ` · ${i.onOrder} on order` : ""}</span></label>
                  <Input id={`qty:${i.id}`} name={`qty:${i.id}`} inputMode="numeric" placeholder="0" className="w-20 text-right" />
                </li>
              ))}
            </ul>
          )}
          <SubmitButton pendingText="Saving…">Add to stock</SubmitButton>
        </ActionForm>
      </Card>
      </div>
      </Disclosure>
    </div>
  );
}
