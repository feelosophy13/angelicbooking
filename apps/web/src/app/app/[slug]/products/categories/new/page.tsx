import { requireAction } from "@/lib/tenant";
import { Button, Field, FormPage, Input } from "@/components/ui";
import { createCategory } from "../../../categories-actions";

export default async function NewProductCategoryPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  await requireAction(slug, "services.manage");
  return (
    <FormPage title="New product category" backHref={`/app/${slug}/products/categories`} backLabel="Product categories" width="max-w-md">
      <form action={createCategory} className="space-y-3">
        <input type="hidden" name="slug" value={slug} />
        <input type="hidden" name="kind" value="product" />
        <Field label="Name"><Input name="name" required placeholder="Hair care" autoFocus /></Field>
        <Button type="submit">Create category</Button>
      </form>
    </FormPage>
  );
}
