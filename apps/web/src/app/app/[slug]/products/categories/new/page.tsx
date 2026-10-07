import type { Metadata } from "next";
import { requireAction } from "@/lib/tenant";
import { FormPage, Input } from "@/components/ui";
import { ActionForm, Field, SubmitButton } from "@/components/form";
import { createCategory } from "../../../categories-actions";

export const metadata: Metadata = { title: "New product category" };

export default async function NewCategoryPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  await requireAction(slug, "services.manage");
  return (
    <FormPage title="New product category" backHref={`/app/${slug}/products/categories`} backLabel="Product categories" width="max-w-md">
      <ActionForm action={createCategory}>
        <input type="hidden" name="slug" value={slug} />
        <input type="hidden" name="kind" value="product" />
        <Field label="Name" name="name" required><Input name="name" required placeholder="Hair care" autoFocus /></Field>
        <SubmitButton pendingText="Creating…">Create category</SubmitButton>
      </ActionForm>
    </FormPage>
  );
}
