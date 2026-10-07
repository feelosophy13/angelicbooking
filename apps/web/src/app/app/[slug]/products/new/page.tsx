import type { Metadata } from "next";
import { requireAction } from "@/lib/tenant";
import { listCategories } from "@/server/categories";
import { FormPage, Input } from "@/components/ui";
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
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="taxable" defaultChecked className="h-4 w-4 accent-brand-600" /> Taxable</label>
        <SubmitButton pendingText="Saving…">Create product</SubmitButton>
      </ActionForm>
    </FormPage>
  );
}
