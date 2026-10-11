import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { requireAction } from "@/lib/tenant";
import { getSubmission } from "@/server/forms";
import { BackLink, Card, PageHeader } from "@/components/ui";
import { SubmissionView } from "@/components/submission-view";

export const metadata: Metadata = { title: "Signed form" };

export default async function SubmissionPage({ params }: { params: Promise<{ slug: string; submissionId: string }> }) {
  const { slug, submissionId } = await params;
  const { business } = await requireAction(slug, "clients.read");
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
    </>
  );
}
