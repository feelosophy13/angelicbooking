import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireAction } from "@/lib/tenant";
import { getSubmission } from "@/server/forms";
import { SubmissionView } from "@/components/submission-view";
import { PrintButton } from "./print-button";

export const metadata: Metadata = { title: "Signed form" };

/** Clean copy of a signed form for the file: print it or save it as a PDF from the browser's print dialog. */
export default async function PrintSubmissionPage({ params }: { params: Promise<{ slug: string; submissionId: string }> }) {
  const { slug, submissionId } = await params;
  const { business } = await requireAction(slug, "clients.notes");
  const row = await getSubmission(business.id, submissionId);
  if (!row) notFound();
  const form = row.s.formSnapshot ?? { name: row.form.name, fields: row.form.fields, description: row.form.description };
  const clientName = `${row.client.firstName} ${row.client.lastName}`.trim();
  return (
    <div className="min-h-screen bg-white text-stone-900">
        <div className="mx-auto max-w-2xl p-8 print:p-0">
          <div className="mb-6 flex items-start justify-between gap-4 border-b border-stone-200 pb-4">
            <div>
              <p className="text-lg font-semibold">{business.name}</p>
              {business.addressLine ? <p className="text-xs text-stone-500">{business.addressLine}</p> : null}
              <h1 className="mt-3 text-xl font-semibold">{form.name}</h1>
              <p className="text-sm text-stone-600">{clientName}{row.client.email ? ` · ${row.client.email}` : ""}{row.client.phone ? ` · ${row.client.phone}` : ""}</p>
            </div>
            <PrintButton />
          </div>
          <SubmissionView submission={row.s} form={form} timeZone={business.timezone} clientName={clientName} assistedByName={row.assistedByName} />
          <p className="mt-8 text-[10px] text-stone-400">Record {row.s.id} · exported {new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: business.timezone }).format(new Date())}</p>
        </div>
    </div>
  );
}
