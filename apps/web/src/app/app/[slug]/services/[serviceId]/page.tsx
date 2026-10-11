import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { schema, withTenant } from "@angelic/db";
import { requireAction } from "@/lib/tenant";
import { listCategories } from "@/server/categories";
import { FormPage, Input, Textarea, Checkbox } from "@/components/ui";
import { ActionForm, Field, SubmitButton } from "@/components/form";
import { CategoryPicker, CategoryThumb } from "@/components/categories";
import { updateService } from "../actions";
import { OfferedAt } from "@/components/offered-at";
import { listLocations } from "@/server/locations";

export async function generateMetadata({ params }: { params: Promise<{ slug: string; serviceId: string }> }): Promise<Metadata> {
  const { slug, serviceId } = await params;
  const { business } = await requireAction(slug, "services.manage");
  const s = await withTenant(business.id, (tx) => tx.query.services.findFirst({ where: eq(schema.services.id, serviceId) }));
  return { title: s ? `${s.name} · Services` : "Service" };
}

export default async function EditServicePage({ params }: { params: Promise<{ slug: string; serviceId: string }> }) {
  const { slug, serviceId } = await params;
  const { business } = await requireAction(slug, "services.manage");
  const [service, categories, locations, offeredAt] = await Promise.all([
    withTenant(business.id, (tx) => tx.query.services.findFirst({ where: eq(schema.services.id, serviceId) })),
    listCategories(business.id, "service"),
    listLocations(business.id),
    withTenant(business.id, (tx) => tx.select({ locationId: schema.serviceLocations.locationId }).from(schema.serviceLocations).where(eq(schema.serviceLocations.serviceId, serviceId))),
  ]);
  if (!service) notFound();
  const $ = (c: number) => (c / 100).toFixed(2);
  return (
    <FormPage title={service.name} backHref={service.categoryId ? `/app/${slug}/services/categories/${service.categoryId}` : `/app/${slug}/services`} backLabel={service.categoryId ? (categories.find((c) => c.id === service.categoryId)?.name ?? "Services") : "Services"}>
      <ActionForm action={updateService}>
        <input type="hidden" name="slug" value={slug} />
        <input type="hidden" name="serviceId" value={service.id} />
        <Field label="Name" name="name" required><Input name="name" defaultValue={service.name} required placeholder="Women's haircut" autoFocus /></Field>
        <Field label="Category" name="categoryIdNew"><CategoryPicker name="categoryId" categories={categories} value={service.categoryId} /></Field>
        <Field label="Description" name="description" hint="Shown on the booking page."><Textarea name="description" rows={2} defaultValue={service.description ?? ""} /></Field>
        <Field label="Before your visit" name="prepNotes" hint="Prep instructions sent with the confirmation and the reminder, e.g. “Patch test 48 hours before.” Leave empty to use the category's note."><Textarea name="prepNotes" rows={2} defaultValue={service.prepNotes ?? ""} /></Field>
        <Field label="Photo" name="image" hint="PNG/JPEG/WebP up to 2 MB. Shown next to the service on the booking page; uploading replaces the current one.">
          <div className="flex flex-wrap items-start gap-4">
            <CategoryThumb imageUrl={service.imageUrl} name={service.name} icon="image" className="h-24 w-24 rounded-lg" />
            <div className="space-y-2">
              <input type="file" name="image" accept="image/*" className="block text-sm" />
              {service.imageUrl ? <Checkbox name="removeImage" label="Remove the current photo" /> : null}
            </div>
          </div>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Duration (min)" name="durationMin" required><Input name="durationMin" type="number" min={5} step={5} defaultValue={service.durationMin} required /></Field>
          <Field label="Price" name="price" required><Input name="price" inputMode="decimal" defaultValue={$(service.priceCents)} placeholder="65" required /></Field>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <Field label="Processing (min)" name="gapMin" hint="Free gap, e.g. colour developing"><Input name="gapMin" type="number" min={0} step={5} defaultValue={service.gapMin} /></Field>
          <Field label="Finish (min)" name="finishMin" hint="Second block after the gap"><Input name="finishMin" type="number" min={0} step={5} defaultValue={service.finishMin} /></Field>
          <Field label="Buffer (min)" name="bufferAfterMin" hint="Clean-up after"><Input name="bufferAfterMin" type="number" min={0} step={5} defaultValue={service.bufferAfterMin} /></Field>
        </div>
        <Field label="Deposit" name="deposit" hint="Charged when booking online (Stripe must be connected); comes off the bill at checkout and is refunded on cancellations inside the policy window."><Input name="deposit" inputMode="decimal" defaultValue={service.depositCents ? $(service.depositCents) : ""} placeholder="0" /></Field>
        <Field label="Group size" name="capacity" hint="1 = one client at a time. Higher numbers make this a class: you schedule sessions under Classes and several clients book the same one."><Input name="capacity" type="number" min={1} max={500} defaultValue={service.capacity} /></Field>
        <Checkbox name="bookableOnline" defaultChecked={service.bookableOnline} label="Bookable online" />
        <OfferedAt locations={locations} selected={offeredAt.map((r) => r.locationId)} />
        <SubmitButton pendingText="Saving…">Save service</SubmitButton>
      </ActionForm>
    </FormPage>
  );
}
