import type { Metadata } from "next";
import { requireAction } from "@/lib/tenant";
import { listCategories } from "@/server/categories";
import { FormPage } from "@/components/ui";
import { ActionForm, SubmitButton } from "@/components/form";
import { ProductFields } from "@/components/product-fields";
import { createProduct } from "../actions";

export const metadata: Metadata = { title: "New product" };

export default async function NewProductPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { business } = await requireAction(slug, "services.manage");
  const categories = await listCategories(business.id, "product");
  return (
    <FormPage title="New product" backHref={`/app/${slug}/products`} backLabel="Products">
      <ActionForm action={createProduct}>
        <input type="hidden" name="slug" value={slug} />
        <ProductFields categories={categories} currency={business.currency} />
        <SubmitButton pendingText="Saving…">Create product</SubmitButton>
      </ActionForm>
    </FormPage>
  );
}
