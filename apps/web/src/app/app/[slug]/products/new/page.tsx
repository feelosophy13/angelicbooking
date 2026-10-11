import type { Metadata } from "next";
import { requireAction } from "@/lib/tenant";
import { listCategories } from "@/server/categories";
import { FormPage, Input, Textarea, Checkbox } from "@/components/ui";
import { ActionForm, Field, SubmitButton } from "@/components/form";
import { CategoryPicker } from "@/components/categories";
import { createProduct } from "../actions";

export const metadata: Metadata = { title: "New product" };

export default async function NewProductPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { business } = await requireAction(slug, "services.manage");
  const categories = await listCategories(business.id, "product");
  return (
    <FormPage title="New product" backHref={`/app/${slug}/products`} backLabel="Products" width="max-w-xl">
      <ActionForm action={createProduct}>
        <input type="hidden" name="slug" value={slug} />
        
        <Field label="Name" name="name" required><Input name="name" defaultValue="" required placeholder="Moisture shampoo 250ml" autoFocus /></Field>
        <Field label="Category" name="categoryIdNew"><CategoryPicker name="categoryId" categories={categories} value={null} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Price" name="price" required><Input name="price" inputMode="decimal" defaultValue="" required placeholder="24" /></Field>
          <Field label="SKU" name="sku"><Input name="sku" defaultValue="" /></Field>
        </div>
        <Checkbox name="taxable" defaultChecked={true} label="Taxable" />
        <fieldset className="rounded-lg border border-stone-200 p-3">
          <legend className="px-1 text-sm font-medium text-stone-700">Online store</legend>
          <Checkbox name="sellOnline" defaultChecked={false} label="Sell online (needs the store turned on under Settings → Online store)" />
          <Field label="Description" name="description" className="mt-2"><Textarea name="description" rows={2} defaultValue={""} /></Field>
          <Field label="Photo" name="image" hint="PNG/JPEG/WebP up to 2 MB." className="mt-2"><input type="file" name="image" accept="image/*" className="block text-sm" /></Field>
          
        </fieldset>
        <fieldset className="rounded-lg border border-stone-200 p-3">
          <legend className="px-1 text-sm font-medium text-stone-700">Inventory</legend>
          <Checkbox name="trackStock" defaultChecked={false} label="Track stock (sales reduce the count; low-stock warning)" />
          <div className="mt-2 grid grid-cols-2 gap-3">
            <Field label="Low-stock warning at" name="lowStockThreshold"><Input name="lowStockThreshold" type="number" min={0} defaultValue={3} /></Field>
            <Field label="Cost per unit" name="cost" hint="For the stock value report."><Input name="cost" inputMode="decimal" defaultValue={""} placeholder="0" /></Field>
          </div>
        </fieldset>
        <SubmitButton pendingText="Saving…">Create product</SubmitButton>
      </ActionForm>
    </FormPage>
  );
}
