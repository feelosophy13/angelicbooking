import type { Metadata } from "next";

export const metadata: Metadata = { title: "Import from Vagaro" };
import { desc } from "drizzle-orm";
import { schema, withTenant } from "@angelic/db";
import { requireAction } from "@/lib/tenant";
import { FIELDS } from "@/lib/import/mapping";
import { BackLink, Card, PageHeader, Notice } from "@/components/ui";
import { readStaged } from "./actions";
import { MappingForm, UploadForm } from "./forms";

export default async function ImportPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ staged?: string; done?: string }> }) {
  const { slug } = await params;
  const sp = await searchParams;
  const { business } = await requireAction(slug, "business.manage");
  const staged = sp.staged ? await readStaged(business.id, sp.staged) : null;
  const jobs = await withTenant(business.id, (tx) => tx.select().from(schema.importJobs).orderBy(desc(schema.importJobs.createdAt)).limit(10));
  let done: { kind: string; created: number; updated: number; skipped: number; errors: { row: number; message: string }[] } | null = null;
  try {
    if (sp.done) done = JSON.parse(sp.done);
  } catch {}
  const fmt = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: business.timezone });

  return (
    <>
      <div className="mb-2"><BackLink href={`/app/${slug}/settings`}>Settings</BackLink></div>
      <PageHeader title="Import from Vagaro" />
      {done ? (
        <div className="mb-4">
          <Notice kind={done.errors.length ? "error" : "success"}>
            Imported {done.kind}: {done.created} created, {done.updated} updated, {done.skipped} skipped{done.errors.length ? `, ${done.errors.length} errors` : ""}.
            {done.errors.length ? <ul className="mt-1 list-disc pl-5 text-xs">{done.errors.map((e, i) => <li key={i}>Row {e.row}: {e.message}</li>)}</ul> : null}
          </Notice>
        </div>
      ) : null}
      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        <div className="space-y-6">
          {staged ? (
            <Card className="p-4">
              <h2 className="mb-1 font-medium">Match columns · {staged.filename}</h2>
              <p className="mb-3 text-xs text-stone-500">{staged.rows.length} rows · {staged.headers.length} columns. We guessed the mapping; adjust anything that looks wrong.</p>
              <MappingForm slug={slug} staged={staged.id} headers={staged.headers} fields={FIELDS[staged.kind]} mapping={staged.mapping} rowCount={staged.rows.length} />
              <h3 className="mb-1 mt-4 text-sm font-medium">First rows</h3>
              <div className="overflow-x-auto rounded-lg border border-stone-200">
                <table className="w-full text-xs">
                  <thead className="bg-stone-50 text-left text-stone-500"><tr>{staged.headers.map((h) => <th key={h} className="whitespace-nowrap px-2 py-1">{h}</th>)}</tr></thead>
                  <tbody className="divide-y divide-stone-100">
                    {staged.rows.slice(0, 5).map((r, i) => <tr key={i}>{staged.headers.map((h) => <td key={h} className="whitespace-nowrap px-2 py-1">{r[h]}</td>)}</tr>)}
                  </tbody>
                </table>
              </div>
            </Card>
          ) : (
            <Card className="p-4">
              <h2 className="mb-3 font-medium">Upload an export</h2>
              <UploadForm slug={slug} />
            </Card>
          )}
          <Card className="p-4 text-sm text-stone-600">
            <h2 className="mb-1 font-medium text-stone-800">Recommended order</h2>
            <ol className="list-decimal space-y-1 pl-5">
              <li><span className="font-medium">Services</span> first (Vagaro: Reports → Services, or your menu export). Existing names are skipped.</li>
              <li><span className="font-medium">Clients</span> (Vagaro: Customers → Export). Matched by phone or email, then by name; existing clients are updated, never duplicated.</li>
              <li><span className="font-medium">Appointments</span> (Vagaro: Reports → Appointments, future date range). Staff names must match your Staff list; unknown services are created as hidden placeholders. Overlaps with existing bookings are reported, not forced.</li>
            </ol>
            <p className="mt-2 text-xs">Re-running an import is safe: duplicates are detected and skipped.</p>
          </Card>
        </div>
        <Card className="p-4">
          <h2 className="mb-2 font-medium">Recent imports</h2>
          {jobs.length === 0 ? <p className="text-sm text-stone-500">None yet.</p> : (
            <ul className="divide-y divide-stone-100 text-sm">
              {jobs.map((j) => (
                <li key={j.id} className="py-2">
                  <p className="font-medium">{j.kind} · {j.filename}</p>
                  <p className="text-xs text-stone-500">{fmt.format(j.createdAt)} · {j.rowCount} rows · {j.created} created, {j.updated} updated, {j.skipped} skipped, {(j.errors as unknown[]).length} errors</p>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}
