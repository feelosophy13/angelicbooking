"use client";
import Link from "next/link";
import { useState } from "react";
import { ImageField } from "@/components/image-field";
import { Input, MoneyInput, Select, Textarea, Checkbox } from "@/components/ui";
import { Field } from "@/components/form";
import { Disclosure } from "@/components/disclosure";

type Product = {
  name: string;
  variantLabel: string | null;
  kind: string;
  categoryId: string | null;
  priceCents: number;
  sku: string | null;
  barcode: string | null;
  taxable: boolean;
  sellOnline: boolean;
  description: string | null;
  imageUrl: string | null;
  trackStock: boolean;
  lowStockThreshold: number;
  reorderUpTo: number | null;
  supplierId: string | null;
  costCents: number;
};

/** The body of the new / edit product forms: one place, so the two never drift. */
export function ProductFields({ product, category, suppliers, currency, storeOn, slug, mode = "plain" }: { product?: Product; /** The category picker, built by the page (it reads from the server). */ category: React.ReactNode; suppliers: { id: string; name: string }[]; currency: string; /** Whether the online store is on (Settings → Online store). */ storeOn: boolean; slug: string; /** new: may come in options; option: one option of a product (the shared details are the group's); plain: a product on its own. */ mode?: "new" | "option" | "plain" }) {
  const option = mode === "option";
  const [kind, setKind] = useState(product?.kind ?? "retail");
  const [tracked, setTracked] = useState(product?.trackStock ?? false);
  const retail = kind === "retail";
  const counted = !retail || tracked;
  return (
    <>
      {option ? (
        <>
          <input type="hidden" name="name" value={product?.name ?? ""} />
          <input type="hidden" name="kind" value={kind} />
          <Field label="Option" name="variantLabel" required hint="What makes this one different: its size or shade. The rest is shared with the product's other options."><Input name="variantLabel" defaultValue={product?.variantLabel ?? ""} required placeholder="250 ml, 7N…" autoFocus /></Field>
          <Field label="Photo of this option" name="image" hint="Optional. Without one, this option uses the product's photo (and follows it when it changes). Remove it to go back to the product's photo."><ImageField name="image" removeName="removeImage" current={product?.imageUrl ?? null} /></Field>
        </>
      ) : (
        <>
          <Field label="Name" name="name" required><Input name="name" defaultValue={product?.name ?? ""} required placeholder="Moisture shampoo" autoFocus /></Field>
          <Field label="What it is" name="kind" hint="Back-bar products are used up in services (color, developer, foils): they are counted, never sold.">
            <Select name="kind" value={kind} onChange={(e) => setKind(e.target.value)}>
              <option value="retail">Sold to clients</option>
              <option value="backbar">Used in services (back-bar)</option>
            </Select>
          </Field>
          <Field label="Category" name="categoryIdNew">{category}</Field>
        </>
      )}
      {mode === "new" ? (
        <Disclosure title="Comes in sizes or shades?" hint="optional">
          <p className="mb-2 text-xs text-stone-500">Type the options, one per line, and each becomes its own option with its own barcode and stock. They share the name, photo and description.</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Options" name="options"><Textarea name="options" rows={4} placeholder={"7N\n8N\n9N"} /></Field>
            <Field label="A second kind (optional)" name="options2" hint="Each option above is made in each of these, like sizes."><Textarea name="options2" rows={4} placeholder={"50 ml\n100 ml"} /></Field>
          </div>
        </Disclosure>
      ) : null}
      <div className="grid grid-cols-2 gap-3">
        {retail ? <Field label="Price" name="price" required><MoneyInput name="price" currency={currency} defaultValue={product ? (product.priceCents / 100).toFixed(2) : ""} required /></Field> : null}
        <Field label="Cost per unit" name="cost" hint="For stock value and orders."><MoneyInput name="cost" currency={currency} defaultValue={product?.costCents ? (product.costCents / 100).toFixed(2) : ""} /></Field>
        {mode !== "new" ? <Field label="SKU" name="sku"><Input name="sku" defaultValue={product?.sku ?? ""} /></Field> : null}
        {mode !== "new" ? <Field label="Barcode" name="barcode" hint="What a scanner reads (UPC / EAN)."><Input name="barcode" inputMode="numeric" defaultValue={product?.barcode ?? ""} /></Field> : null}
      </div>
      {!option ? (
        <>
          {retail ? <Checkbox name="taxable" defaultChecked={product?.taxable ?? true} label="Taxable" /> : null}
          {retail ? (
            storeOn ? (
              <Checkbox name="sellOnline" defaultChecked={product?.sellOnline ?? false} label="Sell online" hint="Listed in the shop on your booking page." />
            ) : (
              <p className="text-xs text-stone-500">To sell it online, turn the store on under <Link href={`/app/${slug}/settings/store`} className="underline">Settings → Online store</Link>.</p>
            )
          ) : null}
          <Field label="Description" name="description"><Textarea name="description" rows={4} defaultValue={product?.description ?? ""} /></Field>
          <Field label="Photo" name="image"><ImageField name="image" removeName={product ? "removeImage" : undefined} current={product?.imageUrl ?? null} /></Field>
        </>
      ) : null}
      <fieldset className="rounded-lg border border-stone-200 p-3">
        <legend className="px-1 text-sm font-medium text-stone-700">Inventory</legend>
        {retail ? <Checkbox name="trackStock" checked={tracked} onChange={(e) => setTracked(e.target.checked)} label="Track stock" hint="Sales reduce the count and you are warned when it runs low." /> : null}
        {counted ? (
          <div className={`grid grid-cols-2 gap-3 ${retail ? "mt-2" : ""}`}>
            <Field label="Low-stock warning at" name="lowStockThreshold" hint="Also the point to reorder."><Input name="lowStockThreshold" type="number" min={0} defaultValue={product?.lowStockThreshold ?? 3} /></Field>
            <Field label="Order up to" name="reorderUpTo" hint="Blank: twice the warning level."><Input name="reorderUpTo" type="number" min={0} defaultValue={product?.reorderUpTo ?? ""} /></Field>
          </div>
        ) : (
          <>
            <input type="hidden" name="lowStockThreshold" value={product?.lowStockThreshold ?? 3} />
            <input type="hidden" name="reorderUpTo" value={product?.reorderUpTo ?? ""} />
          </>
        )}
        {option ? (
          <input type="hidden" name="supplierId" value={product?.supplierId ?? ""} />
        ) : suppliers.length ? (
          <Field label="Usual supplier" name="supplierId" className="mt-2">
            <Select name="supplierId" defaultValue={product?.supplierId ?? ""}>
              <option value="">None</option>
              {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </Select>
          </Field>
        ) : null}
      </fieldset>
    </>
  );
}
