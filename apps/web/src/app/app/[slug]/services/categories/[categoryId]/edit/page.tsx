import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireAction } from "@/lib/tenant";
import { listCategories, subtreeIds } from "@/server/categories";
import { Card, FormPage, Input, Textarea, Checkbox } from "@/components/ui";
import { ActionForm, ConfirmSubmit, Field, SubmitButton } from "@/components/form";
import { CategoryPicker, CategoryThumb } from "@/components/categories";
import { removeCategory, updateServiceCategoryAction } from "../../../../categories-actions";

export const metadata: Metadata = { title: "Edit category" };

export default async function EditCategoryPage({ params }: { params: Promise<{ slug: string; categoryId: string }> }) {
  const { slug, categoryId } = await params;
  const { business } = await requireAction(slug, "services.manage");
  const categories = await listCategories(business.id, "service");
  const me = categories.find((c) => c.id === categoryId);
  if (!me) notFound();
  // A category can't be moved inside itself or one of its own sub-categories.
  const exclude = subtreeIds(categories, me.id);
  return (
    <FormPage title={me.name} backHref={`/app/${slug}/services/categories/${me.id}`} backLabel={me.name} width="max-w-xl">
      <ActionForm action={updateServiceCategoryAction}>
        <input type="hidden" name="slug" value={slug} />
        <input type="hidden" name="id" value={me.id} />
        <Field label="Name" name="name" required><Input name="name" defaultValue={me.name} required autoFocus /></Field>
        <Field label="Inside" name="parentId" hint="Move this category under another one, or to the top level."><CategoryPicker name="parentId" categories={categories} value={me.parentId} exclude={exclude} allowNew={false} emptyLabel="Top level" /></Field>
        <Field label="Description" name="description" hint="Optional. Shown under the category on the booking page."><Textarea name="description" rows={4} defaultValue={me.description ?? ""} /></Field>
        <Field label="Before your visit" name="prepNotes" hint="Prep instructions for every service in this category, sent with the confirmation and the reminder. A service's own note takes precedence."><Textarea name="prepNotes" rows={4} defaultValue={me.prepNotes ?? ""} placeholder="Please arrive with clean, product-free hair." /></Field>
        <Field label="Image" name="image" hint="PNG/JPEG/WebP up to 2 MB. Landscape works best (5:3). Uploading replaces the current image.">
          <div className="flex flex-wrap items-start gap-4">
            <CategoryThumb imageUrl={me.imageUrl} name={me.name} className="h-24 w-40 rounded-lg text-2xl" />
            <div className="space-y-2">
              <input type="file" name="image" accept="image/*" className="block text-sm" />
              {me.imageUrl ? <Checkbox name="removeImage" label="Remove the current image" /> : null}
            </div>
          </div>
        </Field>
        <SubmitButton pendingText="Saving…">Save category</SubmitButton>
      </ActionForm>
      <Card className="mt-6 border-red-100 p-4">
        <h2 className="text-sm font-medium text-stone-800">Delete this category</h2>
        <p className="mb-3 text-xs text-stone-500">Its services become uncategorised and any sub-categories move up one level.</p>
        <form action={removeCategory}>
          <input type="hidden" name="slug" value={slug} />
          <input type="hidden" name="kind" value="service" />
          <input type="hidden" name="id" value={me.id} />
          <input type="hidden" name="redirectTo" value="browser" />
          <ConfirmSubmit title={`Delete “${me.name}”?`} body="Services in it become uncategorised; sub-categories move up a level. This can't be undone." confirmLabel="Delete category">Delete category</ConfirmSubmit>
        </form>
      </Card>
    </FormPage>
  );
}
