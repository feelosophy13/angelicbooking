import { requireAction } from "@/lib/tenant";
import { Button, Field, FormPage, Input } from "@/components/ui";
import { createCategory } from "../../../categories-actions";

export default async function NewServiceCategoryPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  await requireAction(slug, "services.manage");
  return (
    <FormPage title="New service category" backHref={`/app/${slug}/services/categories`} backLabel="Service categories" width="max-w-md">
      <form action={createCategory} className="space-y-3">
        <input type="hidden" name="slug" value={slug} />
        <input type="hidden" name="kind" value="service" />
        <Field label="Name"><Input name="name" required placeholder="Hair" autoFocus /></Field>
        <Button type="submit">Create category</Button>
      </form>
    </FormPage>
  );
}
