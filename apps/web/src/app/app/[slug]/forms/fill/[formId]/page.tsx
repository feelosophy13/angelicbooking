import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { schema, withTenant } from "@angelic/db";
import { requireAction } from "@/lib/tenant";
import { getForm, latestAnswers } from "@/server/forms";
import { brandVars } from "@/lib/brand";
import { BackLink, Card, PageHeader } from "@/components/ui";
import { FormFill } from "@/components/form-fill";
import { submitFormAsStaff } from "../../actions";

export const metadata: Metadata = { title: "Complete a form" };

/** Hand the device to the client: the same form they would see on their phone, recorded as staff-assisted. */
export default async function StaffFillFormPage({ params, searchParams }: { params: Promise<{ slug: string; formId: string }>; searchParams: Promise<{ clientId?: string; appointmentId?: string }> }) {
  const { slug, formId } = await params;
  const { clientId, appointmentId } = await searchParams;
  const { business } = await requireAction(slug, "clients.write");
  if (!clientId) notFound();
  const [form, client, defaults] = await Promise.all([
    getForm(business.id, formId),
    withTenant(business.id, (tx) => tx.query.clients.findFirst({ where: eq(schema.clients.id, clientId) })),
    withTenant(business.id, (tx) => latestAnswers(tx, clientId, formId)),
  ]);
  if (!form || !form.active || !client) notFound();
  const back = appointmentId ? `/app/${slug}/appointments/${appointmentId}` : `/app/${slug}/clients/${client.id}`;
  const clientName = `${client.firstName} ${client.lastName}`.trim();
  return (
    <div style={brandVars(business.brandColor)}>
      <div className="mb-2"><BackLink href={back}>{appointmentId ? "Appointment" : clientName}</BackLink></div>
      <PageHeader title={form.name}>
        <span className="text-sm text-stone-500">for {clientName}</span>
      </PageHeader>
      <Card className="max-w-2xl p-5">
        <p className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">Hand the device to {client.firstName} to read and sign. The record notes that it was completed with staff help.</p>
        <FormFill action={submitFormAsStaff} hidden={{ slug, formId: form.id, clientId: client.id, ...(appointmentId ? { appointmentId } : {}) }} form={form} clientName={clientName} defaults={defaults} staffMode submitLabel={form.requireSignature ? "Sign and save" : "Save"} />
        <p className="mt-4 text-xs text-stone-500"><Link href={back} className="underline">Back</Link> when done.</p>
      </Card>
    </div>
  );
}
