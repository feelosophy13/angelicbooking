import { requireAction } from "@/lib/tenant";
import { listCategories } from "@/server/categories";
import { Button, Field, FormPage, Input } from "@/components/ui";
import { CategoryPicker } from "@/components/categories";
import { createProduct } from "../actions";

export default async function NewProductPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { business } = await requireAction(slug, "services.manage");
  const categories = await listCategories(business.id, "product");
  return (
    <FormPage title="New product" backHref={`/app/${slug}/products`} backLabel="Products" width="max-w-xl">
      <form action={createProduct} className="space-y-3">
        <input type="hidden" name="slug" value={slug} />
        <Field label="Name"><Input name="name" required placeholder="Moisture shampoo 250ml" autoFocus /></Field>
        <Field label="Category"><CategoryPicker name="categoryId" categories={categories} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Price"><Input name="price" inputMode="decimal" required placeholder="24" /></Field>
          <Field label="SKU"><Input name="sku" /></Field>
        </div>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="taxable" defaultChecked className="h-4 w-4 accent-brand-600" /> Taxable</label>
        <Button type="submit">Create product</Button>
      </form>
    </FormPage>
  );
}
