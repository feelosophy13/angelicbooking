import { requireAction } from "@/lib/tenant";
import { listCategories } from "@/server/categories";
import { Button, Field, FormPage, Input, Textarea } from "@/components/ui";
import { CategoryPicker } from "@/components/categories";
import { createService } from "../actions";

export default async function NewServicePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { business } = await requireAction(slug, "services.manage");
  const categories = await listCategories(business.id, "service");
  return (
    <FormPage title="New service" backHref={`/app/${slug}/services`} backLabel="Services">
      <form action={createService} className="space-y-3">
        <input type="hidden" name="slug" value={slug} />
        <Field label="Name"><Input name="name" required placeholder="Women's haircut" autoFocus /></Field>
        <Field label="Category"><CategoryPicker name="categoryId" categories={categories} /></Field>
        <Field label="Description" hint="Shown on the booking page."><Textarea name="description" rows={2} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Duration (min)"><Input name="durationMin" type="number" min={5} step={5} defaultValue={45} required /></Field>
          <Field label="Price"><Input name="price" inputMode="decimal" placeholder="65" required /></Field>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <Field label="Processing" hint="free gap"><Input name="gapMin" type="number" min={0} step={5} defaultValue={0} /></Field>
          <Field label="Finish" hint="after gap"><Input name="finishMin" type="number" min={0} step={5} defaultValue={0} /></Field>
          <Field label="Buffer" hint="clean-up"><Input name="bufferAfterMin" type="number" min={0} step={5} defaultValue={0} /></Field>
        </div>
        <Field label="Deposit (optional)"><Input name="deposit" inputMode="decimal" placeholder="0" /></Field>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="bookableOnline" defaultChecked className="h-4 w-4 accent-brand-600" /> Bookable online</label>
        <Button type="submit">Create service</Button>
      </form>
    </FormPage>
  );
}
