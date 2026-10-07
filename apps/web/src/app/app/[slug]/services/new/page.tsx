import type { Metadata } from "next";
import { requireAction } from "@/lib/tenant";
import { listCategories } from "@/server/categories";
import { FormPage, Input, Textarea } from "@/components/ui";
import { ActionForm, Field, SubmitButton } from "@/components/form";
import { CategoryPicker } from "@/components/categories";
import { createService } from "../actions";

export const metadata: Metadata = { title: "New service" };

export default async function NewServicePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { business } = await requireAction(slug, "services.manage");
  const categories = await listCategories(business.id, "service");
  return (
    <FormPage title="New service" backHref={`/app/${slug}/services`} backLabel="Services">
      <ActionForm action={createService}>
        <input type="hidden" name="slug" value={slug} />
        
        <Field label="Name" name="name" required><Input name="name" defaultValue="" required placeholder="Women's haircut" autoFocus /></Field>
        <Field label="Category" name="categoryIdNew"><CategoryPicker name="categoryId" categories={categories} value={null} /></Field>
        <Field label="Description" name="description" hint="Shown on the booking page."><Textarea name="description" rows={2} defaultValue="" /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Duration (min)" name="durationMin" required><Input name="durationMin" type="number" min={5} step={5} defaultValue={45} required /></Field>
          <Field label="Price" name="price" required><Input name="price" inputMode="decimal" defaultValue="" placeholder="65" required /></Field>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <Field label="Processing (min)" name="gapMin" hint="Free gap, e.g. colour developing"><Input name="gapMin" type="number" min={0} step={5} defaultValue={0} /></Field>
          <Field label="Finish (min)" name="finishMin" hint="Second block after the gap"><Input name="finishMin" type="number" min={0} step={5} defaultValue={0} /></Field>
          <Field label="Buffer (min)" name="bufferAfterMin" hint="Clean-up after"><Input name="bufferAfterMin" type="number" min={0} step={5} defaultValue={0} /></Field>
        </div>
        <Field label="Deposit" name="deposit" hint="Optional; collected when booking online once Stripe is connected."><Input name="deposit" inputMode="decimal" defaultValue="" placeholder="0" /></Field>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="bookableOnline" defaultChecked className="h-4 w-4 accent-brand-600" /> Bookable online</label>
        <SubmitButton pendingText="Saving…">Create service</SubmitButton>
      </ActionForm>
    </FormPage>
  );
}
