import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { type ChartAnswers, type ChartFieldDef } from "@angelic/core";
import { schema, withTenant } from "@angelic/db";
import { requireAnyAction } from "@/lib/tenant";
import { auditEvent } from "@/lib/audit";
import { BackLink, Card, LinkButton, PageHeader, Textarea } from "@/components/ui";
import { ActionForm, ConfirmSubmit, Field, SubmitButton } from "@/components/form";
import { ChartView } from "@/components/chart-view";
import { canChartClient, canEditDraft, chartPhotos, getChart, lastChartForService } from "@/server/charts";
import { ChartEditor } from "../chart-editor";
import { addAddendumAction, deleteDraftAction } from "../actions";
import { ChartStatusBadge, chartStatusLine, LastTime } from "../parts";

export const metadata: Metadata = { title: "Chart" };

/**
 * One chart. A draft opens for editing (for whoever started it, or anyone who may chart every client); a signed chart is read-only, with
 * its addenda in order underneath and a box to add one. Every opening is written to the activity log.
 */
export default async function ChartPage({ params }: { params: Promise<{ slug: string; noteId: string }> }) {
  const { slug, noteId } = await params;
  const ctx = await requireAnyAction(slug, "charts.read.own", "charts.read.any");
  const data = await withTenant(ctx.business.id, async (tx) => {
    const hit = await getChart(tx, noteId);
    if (!hit || !(await canChartClient(tx, ctx, hit.note.clientId, "read"))) return null;
    const client = await tx.query.clients.findFirst({ where: eq(schema.clients.id, hit.note.clientId), columns: { id: true, firstName: true, lastName: true } });
    const write = await canChartClient(tx, ctx, hit.note.clientId, "write");
    const photos = await chartPhotos(tx, hit.note.appointmentId);
    const visitAt = hit.note.appointmentId ? (await tx.query.appointmentItems.findFirst({ where: eq(schema.appointmentItems.appointmentId, hit.note.appointmentId), columns: { startAt: true }, orderBy: (i, { asc }) => asc(i.startAt) }))?.startAt ?? null : null;
    const last = hit.note.signedAt ? null : await lastChartForService(tx, hit.note.clientId, hit.note.serviceId, hit.note.id);
    return { ...hit, client, write, photos, visitAt, last };
  });
  if (!data?.client) notFound();
  const { note, addenda, staffName, client, write, photos, visitAt, last } = data;
  await auditEvent(ctx.business.id, ctx.user.id, "chart.view", "chart", note.id, { clientId: note.clientId });
  const tz = ctx.business.timezone;
  const name = `${client.firstName} ${client.lastName}`.trim();
  const fields = note.templateSnapshot.fields as ChartFieldDef[];
  const answers = note.answers as ChartAnswers;
  const editing = write && canEditDraft(ctx, note);
  const fmt = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: tz });
  const meta = [note.serviceName, staffName ? `with ${staffName}` : null, visitAt ? new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeZone: tz }).format(visitAt) : null].filter(Boolean).join(" · ");
  return (
    <>
      <div className="mb-2"><BackLink href={`/app/${slug}/clients/${client.id}/charts`}>{`${name}'s charts`}</BackLink></div>
      <PageHeader title={`${note.templateSnapshot.name} · ${name}`}>
        <LinkButton href={`/print/charts/${slug}/${note.id}`} variant="secondary" size="sm" target="_blank">Print or PDF</LinkButton>
      </PageHeader>
      <div className="max-w-3xl space-y-6">
        <Card className="p-5">
          <div className="mb-4 text-sm">
            <p className="flex flex-wrap items-center gap-x-2 gap-y-1"><ChartStatusBadge signed={!!note.signedAt} /><span className="text-stone-600">{chartStatusLine(note, tz)}</span></p>
            {meta || note.appointmentId ? (
              <p className="mt-1 text-stone-500">
                {meta}
                {note.appointmentId ? <>{meta ? " · " : ""}<Link href={`/app/${slug}/appointments/${note.appointmentId}`} className="hit text-brand-700 underline">Open the appointment</Link></> : null}
              </p>
            ) : null}
          </div>
          {editing ? (
            <>
              <LastTime slug={slug} note={last} timeZone={tz} />
              <ChartEditor
                slug={slug}
                hidden={{ noteId: note.id }}
                fields={fields}
                answers={answers}
                photos={photos.map((p) => ({ id: p.id, thumbUrl: `/api/files/${p.thumbFileId ?? p.fileId}`, phase: p.phase }))}
                photosHref={note.appointmentId ? `/app/${slug}/appointments/${note.appointmentId}#photos` : null}
                signerName={ctx.user.name}
              />
            </>
          ) : (
            <>
              <ChartView fields={fields} answers={answers} photos={photos} />
              {!note.signedAt ? <p className="mt-4 text-xs text-stone-500">A draft. Only {note.authorName} can change or sign it.</p> : null}
            </>
          )}
        </Card>
        {note.signedAt ? (
          <Card>
            <h2 className="border-b border-stone-200 px-4 py-2 text-sm font-semibold text-stone-600">Addenda</h2>
            {addenda.length ? (
              <ol className="divide-y divide-stone-100">
                {addenda.map((a) => (
                  <li key={a.id} className="px-4 py-3 text-sm">
                    <p className="whitespace-pre-line text-stone-900">{a.body}</p>
                    <p className="mt-1 text-xs text-stone-500">{a.authorName} · {fmt.format(a.createdAt)}</p>
                  </li>
                ))}
              </ol>
            ) : <p className="px-4 py-3 text-sm text-stone-500">None. The chart reads as signed.</p>}
            {write ? (
              <div className="border-t border-stone-200 p-4">
                <ActionForm action={addAddendumAction} className="space-y-2">
                  <input type="hidden" name="slug" value={slug} />
                  <input type="hidden" name="noteId" value={note.id} />
                  <Field label="Add an addendum" name="body" hint="Kept with your name and the time, after the signed chart. It can't be edited or removed."><Textarea name="body" rows={3} placeholder="e.g. Client called day 2: mild redness settled, no further action." /></Field>
                  <div className="flex justify-end"><SubmitButton variant="secondary" size="sm" pendingText="Adding…">Add addendum</SubmitButton></div>
                </ActionForm>
              </div>
            ) : null}
          </Card>
        ) : editing ? (
          <form action={deleteDraftAction} className="flex justify-end">
            <input type="hidden" name="slug" value={slug} />
            <input type="hidden" name="noteId" value={note.id} />
            <ConfirmSubmit title="Delete this draft?" body="It was never signed, so nothing is kept." confirmLabel="Delete draft" variant="ghost" className="text-stone-500 hover:text-red-600">Delete draft</ConfirmSubmit>
          </form>
        ) : null}
        <p className="text-[11px] text-stone-500">Chart {note.id} · started {fmt.format(note.createdAt)} by {note.authorName}</p>
      </div>
    </>
  );
}
