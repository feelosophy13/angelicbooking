import Link from "next/link";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { schema, withTenant } from "@angelic/db";
import { requireAction } from "@/lib/tenant";
import { listCategories } from "@/server/categories";
import { Button, Card, Field, Input, PageHeader, Textarea } from "@/components/ui";
import { CategoryPicker } from "@/components/categories";
import { updateService } from "../actions";

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
    <>
      <PageHeader title={service.name}>
        <Link href={`/app/${slug}/services`} className="text-sm text-brand-700 underline">← Services</Link>
      </PageHeader>
      <Card className="max-w-2xl p-4">
        <form action={updateService} className="space-y-3">
          <input type="hidden" name="slug" value={slug} />
          <input type="hidden" name="serviceId" value={service.id} />
          <Field label="Name"><Input name="name" defaultValue={service.name} required /></Field>
          <Field label="Category"><CategoryPicker name="categoryId" categories={categories} value={service.categoryId} /></Field>
          <Field label="Description" hint="Shown on the booking page."><Textarea name="description" rows={2} defaultValue={service.description ?? ""} /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Duration (min)"><Input name="durationMin" type="number" min={5} step={5} defaultValue={service.durationMin} required /></Field>
            <Field label="Price"><Input name="price" inputMode="decimal" defaultValue={$(service.priceCents)} required /></Field>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <Field label="Processing" hint="free gap"><Input name="gapMin" type="number" min={0} step={5} defaultValue={service.gapMin} /></Field>
            <Field label="Finish" hint="after gap"><Input name="finishMin" type="number" min={0} step={5} defaultValue={service.finishMin} /></Field>
            <Field label="Buffer" hint="clean-up"><Input name="bufferAfterMin" type="number" min={0} step={5} defaultValue={service.bufferAfterMin} /></Field>
          </div>
          <Field label="Deposit"><Input name="deposit" inputMode="decimal" defaultValue={service.depositCents ? $(service.depositCents) : ""} placeholder="0" /></Field>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="bookableOnline" defaultChecked={service.bookableOnline} className="h-4 w-4 accent-brand-600" /> Bookable online</label>
          <Button type="submit">Save service</Button>
        </form>
      </Card>
    </>
  );
}
