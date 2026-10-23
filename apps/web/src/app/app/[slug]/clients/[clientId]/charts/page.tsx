import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { and, desc, eq, isNotNull } from "drizzle-orm";
import { Plus } from "lucide-react";
import { chartScope, type ChartAnswers, type ChartFieldDef } from "@angelic/core";
import { schema, withTenant } from "@angelic/db";
import { requireActions } from "@/lib/tenant";
import { auditEvent } from "@/lib/audit";
import { AutoSubmitForm } from "@/components/auto-submit-form";
import { BackLink, Card, Empty, LinkButton, PageHeader, Select } from "@/components/ui";
import { rowClass, RowLink } from "@/components/row";
import { ServicePicker } from "@/components/service-picker";
import { ChartView } from "@/components/chart-view";
import { serviceGroups } from "@/server/service-groups";
import { canChartClient, chartFacets, listChartsForClient, type ChartListFilters } from "@/server/charts";
import { ChartStatusBadge } from "../../../charts/parts";
import { ClientTabs } from "../client-tabs";

export const metadata: Metadata = { title: "Charts" };

type SP = { service?: string; template?: string; staff?: string; status?: string; page?: string };

/** A client's treatment charts: the latest for each service at the top for a quick look, then every chart, filtered and paged. */
export default async function ClientChartsPage({ params, searchParams }: { params: Promise<{ slug: string; clientId: string }>; searchParams: Promise<SP> }) {
  const { slug, clientId } = await params;
  const sp = await searchParams;
  const ctx = await requireActions(slug, "clients.read");
  if (!chartScope(ctx.permissions, "read")) notFound();
  const f: ChartListFilters = { serviceId: sp.service || null, templateId: sp.template || null, staffId: sp.staff || null, status: sp.status === "draft" || sp.status === "signed" ? sp.status : null, page: Number(sp.page) || 1 };
  const data = await withTenant(ctx.business.id, async (tx) => {
    const client = await tx.query.clients.findFirst({ where: eq(schema.clients.id, clientId), columns: { id: true, firstName: true, lastName: true, photoUrl: true } });
    if (!client || !(await canChartClient(tx, ctx, clientId, "read"))) return null;
    const [list, facets, write] = await Promise.all([listChartsForClient(tx, clientId, f), chartFacets(tx, clientId), canChartClient(tx, ctx, clientId, "write")]);
    // The newest signed chart of each service, for the quick reference above the list.
    const signed = await tx.select().from(schema.chartNotes).where(and(eq(schema.chartNotes.clientId, clientId), isNotNull(schema.chartNotes.signedAt), isNotNull(schema.chartNotes.serviceId))).orderBy(desc(schema.chartNotes.signedAt)).limit(100);
    const latest = [...new Map(signed.reverse().map((n) => [n.serviceId!, n])).values()].sort((a, b) => b.signedAt!.getTime() - a.signedAt!.getTime()).slice(0, 4);
    return { client, list, facets, write, latest };
  });
  if (!data) notFound();
  const { client, list, facets, write, latest } = data;
  await auditEvent(ctx.business.id, ctx.user.id, "chart.list", "client", clientId, { filters: Object.fromEntries(Object.entries(f).filter(([k, v]) => v && k !== "page")) });
  const groups = await serviceGroups(ctx.business);
  const name = `${client.firstName} ${client.lastName}`.trim();
  const tz = ctx.business.timezone;
  const day = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeZone: tz });
  const filtered = !!(f.serviceId || f.templateId || f.staffId || f.status);
  const qs = (extra: Record<string, string>) => new URLSearchParams({ ...Object.fromEntries(Object.entries(sp).filter(([, v]) => v)), ...extra }).toString();
  const newHref = `/app/${slug}/charts/new?clientId=${client.id}`;
  return (
    <>
      <div className="mb-2"><BackLink href={`/app/${slug}/clients`}>Clients</BackLink></div>
      <PageHeader title={name} lead={client.photoUrl ? /* eslint-disable-next-line @next/next/no-img-element */ <img src={client.photoUrl} alt="" className="h-10 w-10 rounded-full object-cover" /> : undefined}>
        {write ? <LinkButton href={newHref} variant="primary"><Plus className="h-4 w-4" /> New chart</LinkButton> : null}
      </PageHeader>
      <ClientTabs slug={slug} clientId={client.id} charts />
      {latest.length && !filtered && f.page === 1 ? (
        <section className="mb-6">
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-stone-500">Last time, by service</h2>
          <ul className="grid gap-3 md:grid-cols-2">
            {latest.map((n) => (
              <li key={n.id}>
                <Card className={`${rowClass} h-full p-4`}>
                  <RowLink href={`/app/${slug}/charts/${n.id}`} className="font-medium">{n.serviceName ?? n.templateSnapshot.name}</RowLink>
                  <p className="mb-2 text-xs text-stone-500">{day.format(n.signedAt!)} · {n.signedByName ?? n.authorName}</p>
                  {/* The first few answers, no headings or pictures: enough to see what was done last time; the chart itself has the rest. */}
                  <ChartView fields={(n.templateSnapshot.fields as ChartFieldDef[]).filter((x) => !["photo", "diagram", "heading"].includes(x.type) && (n.answers as ChartAnswers)[x.id] !== undefined).slice(0, 4)} answers={n.answers as ChartAnswers} compact />
                </Card>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      <Card>
        <AutoSubmitForm className="flex flex-wrap items-center gap-2 border-b border-stone-200 p-3">
          <div className="w-48"><ServicePicker name="service" groups={groups} value={f.serviceId ?? null} noneLabel="Any service" compact /></div>
          {facets.templates.length > 1 ? (
            <Select name="template" defaultValue={f.templateId ?? ""} aria-label="Chart" className="w-44">
              <option value="">Any chart</option>
              {facets.templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </Select>
          ) : null}
          {facets.staff.length > 1 ? (
            <Select name="staff" defaultValue={f.staffId ?? ""} aria-label="Provider" className="w-44">
              <option value="">Any provider</option>
              {facets.staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </Select>
          ) : null}
          <Select name="status" defaultValue={f.status ?? ""} aria-label="Status" className="w-36">
            <option value="">Any status</option>
            <option value="signed">Signed</option>
            <option value="draft">Drafts</option>
          </Select>
          {filtered ? <Link href={`/app/${slug}/clients/${client.id}/charts`} className="hit text-sm text-stone-600 underline">Clear</Link> : null}
        </AutoSubmitForm>
        {list.rows.length === 0 ? (
          <div className="p-4">
            {filtered ? <Empty title="No charts match" body="Try another service or status." /> : <Empty title="No charts yet" body="Chart a visit from the appointment, or start one here. Charts are private to the team members allowed to read them." action={write ? { href: newHref, label: "New chart" } : undefined} />}
          </div>
        ) : (
          <ul className="divide-y divide-stone-100 text-sm">
            {list.rows.map(({ note, staffName, visitAt, addenda }) => (
              <li key={note.id} className={`${rowClass} flex items-center gap-3 px-4 py-3`}>
                <div className="min-w-0 flex-1">
                  <RowLink href={`/app/${slug}/charts/${note.id}`} className="font-medium">{note.templateSnapshot.name}{note.serviceName ? ` · ${note.serviceName}` : ""}</RowLink>
                  <p className="truncate text-xs text-stone-500">{day.format(visitAt ?? note.createdAt)}{staffName ? ` · ${staffName}` : ""}{note.signedAt ? ` · signed by ${note.signedByName}` : ` · started by ${note.authorName}`}{addenda ? ` · ${addenda} addend${addenda === 1 ? "um" : "a"}` : ""}</p>
                </div>
                <div className="w-20 shrink-0 text-right"><ChartStatusBadge signed={!!note.signedAt} /></div>
              </li>
            ))}
          </ul>
        )}
        {list.page > 1 || list.hasMore ? (
          <div className="flex justify-end gap-4 border-t border-stone-200 px-4 py-2 text-sm">
            {list.page > 1 ? <Link href={`?${qs({ page: String(list.page - 1) })}`} className="hit underline">Previous</Link> : null}
            {list.hasMore ? <Link href={`?${qs({ page: String(list.page + 1) })}`} className="hit underline">Next</Link> : null}
          </div>
        ) : null}
      </Card>
    </>
  );
}
