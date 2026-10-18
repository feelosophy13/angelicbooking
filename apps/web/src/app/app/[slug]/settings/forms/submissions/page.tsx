import type { Metadata } from "next";
import Link from "next/link";
import { requireAction } from "@/lib/tenant";
import { listForms, listSubmissions, outstandingForms } from "@/server/forms";
import { BackLink, Card, Empty, Input, PageHeader, Select } from "@/components/ui";
import { LinkRow } from "@/components/table-row";

export const metadata: Metadata = { title: "Form submissions" };

/** Every signed form in one place, plus who still owes one before an upcoming visit. */
export default async function SubmissionsInboxPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ form?: string; q?: string; page?: string }> }) {
  const { slug } = await params;
  const sp = await searchParams;
  const { business } = await requireAction(slug, "clients.notes");
  const page = Math.max(1, Number(sp.page ?? 1) || 1);
  const limit = 50;
  const [forms, { rows, total }, due] = await Promise.all([listForms(business.id), listSubmissions(business.id, { formId: sp.form || null, q: sp.q || null, limit, offset: (page - 1) * limit }), outstandingForms(business, 7)]);
  const fmt = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: business.timezone });
  const day = new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: business.timezone });
  const pages = Math.max(1, Math.ceil(total / limit));
  const qs = (p: number) => `?${new URLSearchParams({ ...(sp.form ? { form: sp.form } : {}), ...(sp.q ? { q: sp.q } : {}), page: String(p) })}`;
  return (
    <>
      <div className="mb-2"><BackLink href={`/app/${slug}/settings/forms`}>Forms</BackLink></div>
      <PageHeader title="Form submissions" />
      {due.length ? (
        <Card className="mb-5">
          <h2 className="border-b border-stone-200 px-4 py-2 text-sm font-semibold text-stone-600">Still to sign before a visit this week</h2>
          <ul className="divide-y divide-stone-100 text-sm">
            {due.map((d) => (
              <li key={d.appointmentId} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2">
                <span className="min-w-0">
                  <Link href={`/app/${slug}/appointments/${d.appointmentId}`} className="font-medium hover:underline">{d.clientName}</Link>
                  <span className="text-stone-500"> · {day.format(d.startAt)} · {d.serviceName}</span>
                </span>
                <span className="flex flex-wrap gap-1.5 text-xs">
                  {d.forms.map((f) => <Link key={f.id} href={`/app/${slug}/forms/fill/${f.id}?clientId=${d.clientId}&appointmentId=${d.appointmentId}`} className="rounded border border-amber-300 bg-amber-50 px-1.5 py-0.5 text-amber-900 hover:bg-amber-100">{f.name} · complete here</Link>)}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
      <form className="mb-3 flex flex-wrap items-end gap-2">
        <Select name="form" defaultValue={sp.form ?? ""} className="w-56"><option value="">All forms</option>{forms.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}</Select>
        <Input name="q" defaultValue={sp.q ?? ""} placeholder="Client name" className="w-56" />
        <button type="submit" className="h-10 rounded-lg border border-stone-300 bg-white px-3 text-sm hover:bg-stone-50">Filter</button>
        <span className="ml-auto text-xs text-stone-500">{total} submission{total === 1 ? "" : "s"}</span>
      </form>
      {rows.length === 0 ? <Empty title="No submissions" body={sp.form || sp.q ? "Nothing matches these filters." : "Signed forms will appear here."} /> : (
        <Card>
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-stone-500"><tr><th className="px-4 py-2">When</th><th className="px-4 py-2">Client</th><th className="px-4 py-2">Form</th><th className="px-4 py-2">Status</th></tr></thead>
            <tbody className="divide-y divide-stone-100">
              {rows.map((r) => (
                <LinkRow key={r.id} href={`/app/${slug}/settings/forms/submissions/${r.id}`}>
                  <td className="whitespace-nowrap px-4 py-2 text-stone-500">{fmt.format(r.createdAt)}</td>
                  <td className="px-4 py-2 font-medium"><Link href={`/app/${slug}/settings/forms/submissions/${r.id}`}>{r.firstName} {r.lastName}</Link></td>
                  <td className="px-4 py-2">{r.formName}</td>
                  <td className="px-4 py-2 text-xs text-stone-500">{r.voidedAt ? <span className="rounded bg-red-50 px-1.5 py-0.5 text-red-700">voided</span> : r.signatureName ? "signed" : "submitted"}{r.assistedByUserId ? " · at the desk" : ""}</td>
                </LinkRow>
              ))}
            </tbody>
          </table>
          {pages > 1 ? (
            <div className="flex items-center justify-between border-t border-stone-200 px-4 py-2 text-xs text-stone-500">
              <span>Page {page} of {pages}</span>
              <span className="flex gap-3">{page > 1 ? <Link href={qs(page - 1)} className="underline">Newer</Link> : null}{page < pages ? <Link href={qs(page + 1)} className="underline">Older</Link> : null}</span>
            </div>
          ) : null}
        </Card>
      )}
    </>
  );
}
