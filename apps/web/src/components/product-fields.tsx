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
export function ProductFields({ product, categories, suppliers, currency, mode = "plain" }: { product?: Product; categories: AnyCategory[]; suppliers: { id: string; name: string }[]; currency: string; /** new: may come in options; option: one option of a product (the shared details are the group's); plain: a product on its own. */ mode?: "new" | "option" | "plain" }) {
  const option = mode === "option";
  return (
    <>
      {option ? (
        <>
          <input type="hidden" name="name" value={product?.name ?? ""} />
          <input type="hidden" name="kind" value={product?.kind ?? "retail"} />
          <Field label="Option" name="variantLabel" required hint="What makes this one different: its size or shade. The rest is shared with the product's other options."><Input name="variantLabel" defaultValue={product?.variantLabel ?? ""} required placeholder="250 ml, 7N…" autoFocus /></Field>
        </>
      ) : (
        <>
          <Field label="Name" name="name" required><Input name="name" defaultValue={product?.name ?? ""} required placeholder="Moisture shampoo" autoFocus /></Field>
          <Field label="What it is" name="kind" hint="Back-bar products are used up in services (color, developer, foils): they are counted, never sold.">
            <Select name="kind" defaultValue={product?.kind ?? "retail"}>
              <option value="retail">Sold to clients</option>
              <option value="backbar">Used in services (back-bar)</option>
            </Select>
          </Field>
          <Field label="Category" name="categoryIdNew"><CategoryPicker name="categoryId" categories={categories} value={product?.categoryId ?? null} /></Field>
        </>
      )}
      {mode === "new" ? (
        <fieldset className="rounded-lg border border-stone-200 p-3">
          <legend className="px-1 text-sm font-medium text-stone-700">Comes in sizes or shades?</legend>
          <p className="mb-2 text-xs text-stone-500">Type the options, one per line, and each becomes its own option with its own barcode and stock. They share the name, photo and description. Leave blank for a product with no options.</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Options" name="options"><Textarea name="options" rows={4} placeholder={"7N\n8N\n9N"} /></Field>
            <Field label="A second kind (optional)" name="options2" hint="Each option above is made in each of these, like sizes."><Textarea name="options2" rows={4} placeholder={"50 ml\n100 ml"} /></Field>
          </div>
        </fieldset>
      ) : null}
      <div className="grid grid-cols-2 gap-3">
        <Field label="Price" name="price" hint="Leave blank for back-bar products."><MoneyInput name="price" currency={currency} defaultValue={product ? (product.priceCents / 100).toFixed(2) : ""} /></Field>
        <Field label="Cost per unit" name="cost" hint="For stock value and orders."><MoneyInput name="cost" currency={currency} defaultValue={product?.costCents ? (product.costCents / 100).toFixed(2) : ""} /></Field>
        {mode !== "new" ? <Field label="SKU" name="sku"><Input name="sku" defaultValue={product?.sku ?? ""} /></Field> : null}
        {mode !== "new" ? <Field label="Barcode" name="barcode" hint="What a scanner reads (UPC / EAN)."><Input name="barcode" inputMode="numeric" defaultValue={product?.barcode ?? ""} /></Field> : null}
      </div>
      {!option ? (
        <>
          <Checkbox name="taxable" defaultChecked={product?.taxable ?? true} label="Taxable" />
          <fieldset className="rounded-lg border border-stone-200 p-3">
            <legend className="px-1 text-sm font-medium text-stone-700">Online store</legend>
            <Checkbox name="sellOnline" defaultChecked={product?.sellOnline ?? false} label="Sell online (needs the store turned on under Settings → Online store)" />
            <Field label="Description" name="description" className="mt-2"><Textarea name="description" rows={4} defaultValue={product?.description ?? ""} /></Field>
            <Field label="Photo" name="image" className="mt-2"><ImageField name="image" removeName={product ? "removeImage" : undefined} current={product?.imageUrl ?? null} /></Field>
          </fieldset>
        </>
      ) : null}
      <fieldset className="rounded-lg border border-stone-200 p-3">
        <legend className="px-1 text-sm font-medium text-stone-700">Inventory</legend>
        <Checkbox name="trackStock" defaultChecked={product?.trackStock ?? false} label="Track stock (sales reduce the count; low-stock warning). Always on for back-bar products." />
        <div className="mt-2 grid grid-cols-2 gap-3">
          <Field label="Low-stock warning at" name="lowStockThreshold" hint="Also the point to reorder."><Input name="lowStockThreshold" type="number" min={0} defaultValue={product?.lowStockThreshold ?? 3} /></Field>
          <Field label="Order up to" name="reorderUpTo" hint="Blank: twice the warning level."><Input name="reorderUpTo" type="number" min={0} defaultValue={product?.reorderUpTo ?? ""} /></Field>
        </div>
        {!option ? (
          <Field label="Usual supplier" name="supplierId" className="mt-2">
            <Select name="supplierId" defaultValue={product?.supplierId ?? ""}>
              <option value="">None</option>
              {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </Select>
          </Field>
        ) : (
          <input type="hidden" name="supplierId" value={product?.supplierId ?? ""} />
        )}
      </fieldset>
    </>
  );
}
