import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { schema, withTenant } from "@angelic/db";
import { requireAction } from "@/lib/tenant";
import { listCategories } from "@/server/categories";
import { FormPage, Input, Textarea } from "@/components/ui";
import { ActionForm, Field, SubmitButton } from "@/components/form";
import { CategoryPicker } from "@/components/categories";
import { updateService } from "../actions";

export async function generateMetadata({ params }: { params: Promise<{ slug: string; serviceId: string }> }): Promise<Metadata> {
  const { slug, serviceId } = await params;
  const { business } = await requireAction(slug, "services.manage");
  const s = await withTenant(business.id, (tx) => tx.query.services.findFirst({ where: eq(schema.services.id, serviceId) }));
  return { title: s ? `${s.name} · Services` : "Service" };
}

export default async function EditServicePage({ params }: { params: Promise<{ slug: string; serviceId: string }> }) {
  const { slug, serviceId } = await params;
  const { business } = await requireAction(slug, "services.manage");
  const [service, categories] = await Promise.all([
    withTenant(business.id, (tx) => tx.query.services.findFirst({ where: eq(schema.services.id, serviceId) })),
    listCategories(business.id, "service"),
  ]);
  if (!service) notFound();
  const $ = (c: number) => (c / 100).toFixed(2);
  return (
    <FormPage title={service.name} backHref={`/app/${slug}/services`} backLabel="Services">
      <ActionForm action={updateService}>
        <input type="hidden" name="slug" value={slug} />
        <input type="hidden" name="serviceId" value={service.id} />
        <Field label="Name" name="name" required><Input name="name" defaultValue={service.name} required placeholder="Women's haircut" autoFocus /></Field>
        <Field label="Category" name="categoryIdNew"><CategoryPicker name="categoryId" categories={categories} value={service.categoryId} /></Field>
        <Field label="Description" name="description" hint="Shown on the booking page."><Textarea name="description" rows={2} defaultValue={service.description ?? ""} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Duration (min)" name="durationMin" required><Input name="durationMin" type="number" min={5} step={5} defaultValue={service.durationMin} required /></Field>
          <Field label="Price" name="price" required><Input name="price" inputMode="decimal" defaultValue={$(service.priceCents)} placeholder="65" required /></Field>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <Field label="Processing (min)" name="gapMin" hint="Free gap, e.g. colour developing"><Input name="gapMin" type="number" min={0} step={5} defaultValue={service.gapMin} /></Field>
          <Field label="Finish (min)" name="finishMin" hint="Second block after the gap"><Input name="finishMin" type="number" min={0} step={5} defaultValue={service.finishMin} /></Field>
          <Field label="Buffer (min)" name="bufferAfterMin" hint="Clean-up after"><Input name="bufferAfterMin" type="number" min={0} step={5} defaultValue={service.bufferAfterMin} /></Field>
        </div>
        <Field label="Deposit" name="deposit" hint="Optional; collected when booking online once Stripe is connected."><Input name="deposit" inputMode="decimal" defaultValue={service.depositCents ? $(service.depositCents) : ""} placeholder="0" /></Field>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="bookableOnline" defaultChecked={service.bookableOnline} className="h-4 w-4 accent-brand-600" /> Bookable online</label>
        <SubmitButton pendingText="Saving…">Save service</SubmitButton>
      </ActionForm>
    </FormPage>
  );
}
