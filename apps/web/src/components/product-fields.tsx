import { ImageField } from "@/components/image-field";
import { Input, MoneyInput, Textarea, Checkbox } from "@/components/ui";
import { Field } from "@/components/form";
import { CategoryPicker } from "@/components/categories";
import type { AnyCategory } from "@/server/categories";

type Product = { name: string; categoryId: string | null; priceCents: number; sku: string | null; taxable: boolean; sellOnline: boolean; description: string | null; imageUrl: string | null; trackStock: boolean; lowStockThreshold: number; costCents: number };

/** The body of the new / edit product forms: one place, so the two never drift. */
export function ProductFields({ product, categories, currency }: { product?: Product; categories: AnyCategory[]; currency: string }) {
  return (
    <>
      <Field label="Name" name="name" required><Input name="name" defaultValue={product?.name ?? ""} required placeholder="Moisture shampoo 250ml" autoFocus /></Field>
      <Field label="Category" name="categoryIdNew"><CategoryPicker name="categoryId" categories={categories} value={product?.categoryId ?? null} /></Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Price" name="price" required><MoneyInput name="price" currency={currency} defaultValue={product ? (product.priceCents / 100).toFixed(2) : ""} required /></Field>
        <Field label="SKU" name="sku"><Input name="sku" defaultValue={product?.sku ?? ""} /></Field>
      </div>
      <Checkbox name="taxable" defaultChecked={product?.taxable ?? true} label="Taxable" />
      <fieldset className="rounded-lg border border-stone-200 p-3">
        <legend className="px-1 text-sm font-medium text-stone-700">Online store</legend>
        <Checkbox name="sellOnline" defaultChecked={product?.sellOnline ?? false} label="Sell online (needs the store turned on under Settings → Online store)" />
        <Field label="Description" name="description" className="mt-2"><Textarea name="description" rows={4} defaultValue={product?.description ?? ""} /></Field>
        <Field label="Photo" name="image" className="mt-2"><ImageField name="image" removeName={product ? "removeImage" : undefined} current={product?.imageUrl ?? null} /></Field>
      </fieldset>
      <fieldset className="rounded-lg border border-stone-200 p-3">
        <legend className="px-1 text-sm font-medium text-stone-700">Inventory</legend>
        <Checkbox name="trackStock" defaultChecked={product?.trackStock ?? false} label="Track stock (sales reduce the count; low-stock warning)" />
        <div className="mt-2 grid grid-cols-2 gap-3">
          <Field label="Low-stock warning at" name="lowStockThreshold"><Input name="lowStockThreshold" type="number" min={0} defaultValue={product?.lowStockThreshold ?? 3} /></Field>
          <Field label="Cost per unit" name="cost" hint="For the stock value report."><MoneyInput name="cost" currency={currency} defaultValue={product?.costCents ? (product.costCents / 100).toFixed(2) : ""} /></Field>
        </div>
      </fieldset>
    </>
  );
}
