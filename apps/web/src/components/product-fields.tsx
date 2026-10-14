import { ImageField } from "@/components/image-field";
import { Input, MoneyInput, Select, Textarea, Checkbox } from "@/components/ui";
import { Field } from "@/components/form";
import { CategoryPicker } from "@/components/categories";
import type { AnyCategory } from "@/server/categories";

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
export function ProductFields({ product, categories, suppliers, currency }: { product?: Product; categories: AnyCategory[]; suppliers: { id: string; name: string }[]; currency: string }) {
  return (
    <>
      <div className="grid grid-cols-[1fr_10rem] gap-3">
        <Field label="Name" name="name" required><Input name="name" defaultValue={product?.name ?? ""} required placeholder="Moisture shampoo" autoFocus /></Field>
        <Field label="Size or shade" name="variantLabel" hint="Same name, one per option."><Input name="variantLabel" defaultValue={product?.variantLabel ?? ""} placeholder="250 ml, 7N…" /></Field>
      </div>
      <Field label="What it is" name="kind" hint="Back-bar products are used up in services (color, developer, foils): they are counted, never sold.">
        <Select name="kind" defaultValue={product?.kind ?? "retail"}>
          <option value="retail">Sold to clients</option>
          <option value="backbar">Used in services (back-bar)</option>
        </Select>
      </Field>
      <Field label="Category" name="categoryIdNew"><CategoryPicker name="categoryId" categories={categories} value={product?.categoryId ?? null} /></Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Price" name="price" hint="Leave blank for back-bar products."><MoneyInput name="price" currency={currency} defaultValue={product ? (product.priceCents / 100).toFixed(2) : ""} /></Field>
        <Field label="Cost per unit" name="cost" hint="For stock value and orders."><MoneyInput name="cost" currency={currency} defaultValue={product?.costCents ? (product.costCents / 100).toFixed(2) : ""} /></Field>
        <Field label="SKU" name="sku"><Input name="sku" defaultValue={product?.sku ?? ""} /></Field>
        <Field label="Barcode" name="barcode" hint="What a scanner reads (UPC / EAN)."><Input name="barcode" inputMode="numeric" defaultValue={product?.barcode ?? ""} /></Field>
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
        <Checkbox name="trackStock" defaultChecked={product?.trackStock ?? false} label="Track stock (sales reduce the count; low-stock warning). Always on for back-bar products." />
        <div className="mt-2 grid grid-cols-2 gap-3">
          <Field label="Low-stock warning at" name="lowStockThreshold" hint="Also the point to reorder."><Input name="lowStockThreshold" type="number" min={0} defaultValue={product?.lowStockThreshold ?? 3} /></Field>
          <Field label="Order up to" name="reorderUpTo" hint="Blank: twice the warning level."><Input name="reorderUpTo" type="number" min={0} defaultValue={product?.reorderUpTo ?? ""} /></Field>
        </div>
        <Field label="Usual supplier" name="supplierId" className="mt-2">
          <Select name="supplierId" defaultValue={product?.supplierId ?? ""}>
            <option value="">None</option>
            {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </Select>
        </Field>
      </fieldset>
    </>
  );
}
