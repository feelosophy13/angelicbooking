import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireAction } from "@/lib/tenant";
import { listCategories } from "@/server/categories";
import { FormPage, Input } from "@/components/ui";
import { ActionForm, Field, SubmitButton } from "@/components/form";
import { ImageField } from "@/components/image-field";
import { updateProductCategoryAction } from "../../../../categories-actions";

export const metadata: Metadata = { title: "Edit product category" };

export default async function EditProductCategoryPage({ params }: { params: Promise<{ slug: string; categoryId: string }> }) {
  const { slug, categoryId } = await params;
  const { business } = await requireAction(slug, "services.manage");
  const me = (await listCategories(business.id, "product")).find((c) => c.id === categoryId);
  if (!me) notFound();
  return (
    <FormPage title={me.name} backHref={`/app/${slug}/products/categories`} backLabel="Product categories" width="max-w-md">
      <ActionForm action={updateProductCategoryAction}>
        <input type="hidden" name="slug" value={slug} />
        <input type="hidden" name="id" value={me.id} />
        <Field label="Name" name="name" required><Input name="name" defaultValue={me.name} required autoFocus /></Field>
        <Field label="Image" name="image" hint="Optional. Landscape works best."><ImageField name="image" removeName="removeImage" current={me.imageUrl ?? null} shape="wide" /></Field>
        <SubmitButton pendingText="Saving…">Save category</SubmitButton>
      </ActionForm>
    </FormPage>
  );
}
