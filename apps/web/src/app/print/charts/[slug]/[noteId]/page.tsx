import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import type { ChartAnswers, ChartFieldDef } from "@angelic/core";
import { schema, withTenant } from "@angelic/db";
import { requireAnyAction } from "@/lib/tenant";
import { auditEvent } from "@/lib/audit";
import { ChartView } from "@/components/chart-view";
import { canChartClient, chartPhotos, getChart } from "@/server/charts";
import { PrintButton } from "../../../forms/[slug]/[submissionId]/print-button";

export const metadata: Metadata = { title: "Chart" };

/** A clean copy of a chart and its addenda for the file: print it, or save it as a PDF from the print dialog. Logged as a print. */
export default async function PrintChartPage({ params }: { params: Promise<{ slug: string; noteId: string }> }) {
  const { slug, noteId } = await params;
  const ctx = await requireAnyAction(slug, "charts.read.own", "charts.read.any");
  const data = await withTenant(ctx.business.id, async (tx) => {
    const hit = await getChart(tx, noteId);
    if (!hit || !(await canChartClient(tx, ctx, hit.note.clientId, "read"))) return null;
    const client = await tx.query.clients.findFirst({ where: eq(schema.clients.id, hit.note.clientId), columns: { firstName: true, lastName: true, birthday: true } });
    const visitAt = hit.note.appointmentId ? (await tx.query.appointmentItems.findFirst({ where: eq(schema.appointmentItems.appointmentId, hit.note.appointmentId), columns: { startAt: true }, orderBy: (i, { asc }) => asc(i.startAt) }))?.startAt ?? null : null;
    return { ...hit, client, visitAt, photos: await chartPhotos(tx, hit.note.appointmentId) };
  });
  if (!data?.client) notFound();
  const { note, addenda, staffName, client, visitAt, photos } = data;
  await auditEvent(ctx.business.id, ctx.user.id, "chart.print", "chart", note.id, { clientId: note.clientId });
  const tz = ctx.business.timezone;
  const fmt = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: tz });
  const day = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeZone: tz });
  const name = `${client.firstName} ${client.lastName}`.trim();
  return (
    <div className="min-h-screen bg-white text-stone-900">
      <div className="mx-auto max-w-2xl p-8 print:p-0">
        <div className="mb-6 flex items-start justify-between gap-4 border-b border-stone-200 pb-4">
          <div>
            <p className="text-lg font-semibold">{ctx.business.name}</p>
            {ctx.business.addressLine ? <p className="text-xs text-stone-500">{ctx.business.addressLine}</p> : null}
            <h1 className="mt-3 text-xl font-semibold">{note.templateSnapshot.name}</h1>
            <p className="text-sm text-stone-600">{name}{client.birthday ? ` · born ${client.birthday}` : ""}</p>
            <p className="text-sm text-stone-600">{[note.serviceName, staffName ? `with ${staffName}` : null, visitAt ? day.format(visitAt) : null].filter(Boolean).join(" · ")}</p>
          </div>
          <PrintButton />
        </div>
        {!note.signedAt ? <p className="mb-4 rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">Draft: not signed.</p> : null}
        <ChartView fields={note.templateSnapshot.fields as ChartFieldDef[]} answers={note.answers as ChartAnswers} photos={photos} />
        <div className="mt-6 border-t border-stone-200 pt-3 text-sm">
          {note.signedAt ? <p>Signed by <span className="font-medium">{note.signedByName}</span> · {fmt.format(note.signedAt)}</p> : <p>Started by {note.authorName} · {fmt.format(note.createdAt)}</p>}
        </div>
        {addenda.length ? (
          <div className="mt-6">
            <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-stone-500">Addenda</h2>
            <ol className="space-y-3">
              {addenda.map((a) => (
                <li key={a.id} className="break-inside-avoid border-l-2 border-stone-300 pl-3 text-sm">
                  <p className="whitespace-pre-line">{a.body}</p>
                  <p className="text-xs text-stone-500">{a.authorName} · {fmt.format(a.createdAt)}</p>
                </li>
              ))}
            </ol>
          </div>
        ) : null}
        <p className="mt-8 text-[10px] text-stone-500">Chart {note.id} · printed {fmt.format(new Date())} by {ctx.user.name} · confidential client record</p>
      </div>
    </div>
  );
}
