import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { schema, withTenant } from "@angelic/db";
import { requireAction } from "@/lib/tenant";
import { getOffersCatalog } from "@/server/offers";
import { listLocations } from "@/server/locations";
import { FormPage, Input, Select } from "@/components/ui";
import { ActionForm, Field, SubmitButton } from "@/components/form";
import { ValidAt } from "@/components/offered-at";
import { updatePackage } from "../../catalog-actions";

export const metadata: Metadata = { title: "Edit package" };

export default async function EditPackagePage({ params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await params;
  const { business } = await requireAction(slug, "services.manage");
  const [p, { services }, locations] = await Promise.all([
    withTenant(business.id, (tx) => tx.query.packages.findFirst({ where: eq(schema.packages.id, id) })),
    getOffersCatalog(business.id),
    listLocations(business.id),
  ]);
  if (!p) notFound();
  return (
    <FormPage title={p.name} backHref={`/app/${slug}/packages`} backLabel="Packages" width="max-w-lg">
      <p className="mb-3 text-xs text-stone-500">Changes apply to packages sold from now on; sessions already bought keep their count and expiry.</p>
      <ActionForm action={updatePackage}>
        <input type="hidden" name="slug" value={slug} />
        <input type="hidden" name="id" value={p.id} />
        <Field label="Name" name="name" required><Input name="name" defaultValue={p.name} required autoFocus /></Field>
        <Field label="Service" name="serviceId" hint="Choose one service, or let sessions be used on any service."><Select name="serviceId" defaultValue={p.serviceId ?? ""}><option value="">Any service</option>{services.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Sessions" name="sessions" required><Input name="sessions" type="number" min={1} defaultValue={p.sessions} required /></Field>
          <Field label="Price" name="price" required><Input name="price" inputMode="decimal" defaultValue={(p.priceCents / 100).toFixed(2)} required /></Field>
        </div>
        <Field label="Valid for (days)" name="validDays" hint="Leave blank if sessions never expire."><Input name="validDays" type="number" min={1} defaultValue={p.validDays ?? ""} /></Field>
        <ValidAt locations={locations} selected={p.validLocationIds} what="package sessions" />
        <SubmitButton pendingText="Saving…">Save package</SubmitButton>
      </ActionForm>
    </FormPage>
  );
}
