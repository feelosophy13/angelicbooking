import { ImageField } from "@/components/image-field";
import type { Metadata } from "next";
import { requireAction } from "@/lib/tenant";
import { listCategories } from "@/server/categories";
import { FormPage, Input, Textarea } from "@/components/ui";
import { ActionForm, Field, SubmitButton } from "@/components/form";
import { CategoryPicker } from "@/components/categories";
import { createCategory } from "../../../categories-actions";

export const metadata: Metadata = { title: "New service category" };

export default async function NewCategoryPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ parent?: string }> }) {
  const { slug } = await params;
  const { parent } = await searchParams;
  const { business } = await requireAction(slug, "services.manage");
  const categories = await listCategories(business.id, "service");
  const parentCat = categories.find((c) => c.id === parent) ?? null;
  return (
    <FormPage title={parentCat ? `New sub-category in ${parentCat.name}` : "New service category"} backHref={parentCat ? `/app/${slug}/services/categories/${parentCat.id}` : `/app/${slug}/services`} backLabel={parentCat ? parentCat.name : "Services"}>
      <ActionForm action={createCategory}>
        <input type="hidden" name="slug" value={slug} />
        <input type="hidden" name="kind" value="service" />
        <Field label="Name" name="name" required><Input name="name" required placeholder={parentCat ? "Balayage" : "Hair"} autoFocus /></Field>
        <Field label="Inside" name="parentId" hint="Leave at top level for a main menu heading, or nest it under another category (Hair › Colour › Balayage)."><CategoryPicker name="parentId" categories={categories} value={parentCat?.id} allowNew={false} emptyLabel="Top level" /></Field>
        <Field label="Description" name="description" hint="Optional. Shown under the category on the booking page."><Textarea name="description" rows={4} placeholder="Cuts, colour and styling for every hair type." /></Field>
        <Field label="Before your visit" name="prepNotes" hint="Prep instructions for every service in this category, sent with the confirmation and the reminder. A service's own note takes precedence."><Textarea name="prepNotes" rows={4} placeholder="Please arrive with clean, product-free hair." /></Field>
        <Field label="Image" name="image" hint="Landscape works best (5:3). Shown as the category tile on the booking page."><ImageField name="image" current={null} shape="wide" /></Field>
        <SubmitButton pendingText="Creating…">Create category</SubmitButton>
      </ActionForm>
    </FormPage>
  );
}
