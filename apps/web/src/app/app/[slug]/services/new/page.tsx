import { ImageField } from "@/components/image-field";
import type { Metadata } from "next";
import { requireAction } from "@/lib/tenant";
import { listCategories } from "@/server/categories";
import { FormPage, Input, Textarea, Checkbox } from "@/components/ui";
import { ActionForm, Field, SubmitButton } from "@/components/form";
import { CategoryPicker } from "@/components/categories";
import { createService } from "../actions";
import { OfferedAt } from "@/components/offered-at";
import { listLocations } from "@/server/locations";

export const metadata: Metadata = { title: "New service" };

export default async function NewServicePage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ category?: string }> }) {
  const { slug } = await params;
  const { category } = await searchParams;
  const { business } = await requireAction(slug, "services.manage");
  const [categories, locations] = await Promise.all([listCategories(business.id, "service"), listLocations(business.id)]);
  return (
    <FormPage title="New service" backHref={`/app/${slug}/services`} backLabel="Services">
      <ActionForm action={createService}>
        <input type="hidden" name="slug" value={slug} />
        <Field label="Name" name="name" required><Input name="name" defaultValue="" required placeholder="Women's haircut" autoFocus /></Field>
        <Field label="Category" name="categoryIdNew"><CategoryPicker name="categoryId" categories={categories} value={categories.some((c) => c.id === category) ? category : null} /></Field>
        <Field label="Description" name="description" hint="Shown on the booking page."><Textarea name="description" rows={4} defaultValue="" /></Field>
        <Field label="Photo" name="image" hint="Shown next to the service on the booking page."><ImageField name="image" current={null} /></Field>
        <Field label="Before your visit" name="prepNotes" hint="Prep instructions sent with the confirmation and the reminder, e.g. “Arrive with clean, dry hair.” Leave empty to use the category's note."><Textarea name="prepNotes" rows={4} defaultValue="" /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Duration (min)" name="durationMin" required><Input name="durationMin" type="number" min={5} step={5} defaultValue={45} required /></Field>
          <Field label="Price" name="price" required><Input name="price" inputMode="decimal" defaultValue="" placeholder="65" required /></Field>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <Field label="Processing (min)" name="gapMin" hint="Free gap, e.g. colour developing"><Input name="gapMin" type="number" min={0} step={5} defaultValue={0} /></Field>
          <Field label="Finish (min)" name="finishMin" hint="Second block after the gap"><Input name="finishMin" type="number" min={0} step={5} defaultValue={0} /></Field>
          <Field label="Buffer (min)" name="bufferAfterMin" hint="Clean-up after"><Input name="bufferAfterMin" type="number" min={0} step={5} defaultValue={0} /></Field>
        </div>
        <Field label="Deposit" name="deposit" hint="Charged when booking online (Stripe must be connected); comes off the bill at checkout and is refunded on cancellations inside the policy window."><Input name="deposit" inputMode="decimal" defaultValue="" placeholder="0" /></Field>
        <Field label="Group size" name="capacity" hint="1 = one client at a time. Higher numbers make this a class: you schedule sessions under Classes and several clients book the same one."><Input name="capacity" type="number" min={1} max={500} defaultValue={1} /></Field>
        <Checkbox name="bookableOnline" defaultChecked label="Bookable online" />
        <OfferedAt locations={locations} selected={[]} />
        <SubmitButton pendingText="Saving…">Create service</SubmitButton>
      </ActionForm>
    </FormPage>
  );
}
