import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { requireAction } from "@/lib/tenant";
import { can } from "@angelic/core";
import { getSubmission } from "@/server/forms";
import { BackLink, Button, Card, Input, PageHeader } from "@/components/ui";
import { ConfirmSubmit } from "@/components/form";
import { ClientPicker } from "@/components/client-picker";
import { Disclosure } from "@/components/disclosure";
import { emailSubmissionAction, reassignSubmissionAction, voidSubmissionAction } from "../../actions";
import { SubmissionView } from "@/components/submission-view";

export const metadata: Metadata = { title: "Signed form" };

export default async function SubmissionPage({ params }: { params: Promise<{ slug: string; submissionId: string }> }) {
  const { slug, submissionId } = await params;
  const { business, permissions } = await requireAction(slug, "clients.read");
  const write = can(permissions, "clients.write");
  const row = await getSubmission(business.id, submissionId);
  if (!row) notFound();
  return (
    <>
      <div className="mb-2"><BackLink href={`/app/${slug}/clients/${row.client.id}`}>{row.client.firstName} {row.client.lastName}</BackLink></div>
      <PageHeader title={row.s.formSnapshot?.name ?? row.form.name}>
        <Link href={`/print/forms/${slug}/${row.s.id}`} target="_blank" className="text-sm text-brand-700 underline">Print / save as PDF</Link>
        <Link href={`/app/${slug}/settings/forms/${row.form.id}`} className="text-sm text-brand-700 underline">Edit form</Link>
      </PageHeader>
      <Card className="max-w-2xl p-5">
        <SubmissionView submission={row.s} form={row.s.formSnapshot ?? { name: row.form.name, fields: row.form.fields, description: row.form.description }} timeZone={business.timezone} clientName={`${row.client.firstName} ${row.client.lastName}`.trim()} previous={row.previous} assistedByName={row.assistedByName} />
      </Card>
      {write ? (
        <div className="mt-4 max-w-2xl space-y-3">
          {row.client.email ? (
            <form action={emailSubmissionAction}>
              <input type="hidden" name="slug" value={slug} /><input type="hidden" name="submissionId" value={row.s.id} />
              <Button type="submit" size="sm" variant="secondary">Email a copy to the client</Button>
            </form>
          ) : (
            <p className="text-xs text-stone-500">No email on file, so a copy can&apos;t be emailed. Add one on <Link href={`/app/${slug}/clients/${row.client.id}`} className="text-brand-700 underline">the client&apos;s page</Link>.</p>
          )}
          {!row.s.voidedAt ? (
            <Disclosure title="Correct this record" hint="void it or move it to another client" className="text-sm">
              <form action={reassignSubmissionAction} className="mb-4 space-y-2">
                <input type="hidden" name="slug" value={slug} /><input type="hidden" name="submissionId" value={row.s.id} />
                <p className="text-xs text-stone-600">Filed under the wrong person? Pick the right client and the form moves to their record.</p>
                <div className="flex flex-wrap items-end gap-2">
                  <div className="w-72"><ClientPicker slug={slug} initial={null} canCreate={false} placeholder="Search clients" /></div>
                  <Button type="submit" size="sm" variant="secondary">Move to this client</Button>
                </div>
              </form>
              <form action={voidSubmissionAction} className="space-y-2 border-t border-stone-200 pt-3">
                <input type="hidden" name="slug" value={slug} /><input type="hidden" name="submissionId" value={row.s.id} />
                <p className="text-xs text-stone-600">Voiding keeps the record for the audit trail but it no longer counts as signed; the client will be asked again.</p>
                <div className="flex flex-wrap items-end gap-2">
                  <Input name="reason" placeholder="Reason (optional)" className="w-72" />
                  <ConfirmSubmit title="Void this submission?" body="It stays on file, marked void, and the client will need to sign again." confirmLabel="Void" variant="ghost" className="text-red-700">Void</ConfirmSubmit>
                </div>
              </form>
            </Disclosure>
          ) : null}
        </div>
      ) : null}
    </>
  );
}
