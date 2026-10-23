import Link from "next/link";
import type { Metadata } from "next";
import { Plus } from "lucide-react";
import { CHART_DISPLAY_TYPES, STARTER_CHART_TEMPLATES } from "@angelic/core";
import { withTenant } from "@angelic/db";
import { requireAction } from "@/lib/tenant";
import { BackLink, Card, LinkButton, PageHeader } from "@/components/ui";
import { rowClass, RowLink } from "@/components/row";
import { chartCountsByTemplate, listChartTemplates } from "@/server/charts";

export const metadata: Metadata = { title: "Chart templates" };

/** The treatment charts (SOAP notes) providers fill in: the salon's own templates, and the starters not added yet. */
export default async function ChartTemplatesPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { business } = await requireAction(slug, "forms.manage");
  const [templates, counts] = await withTenant(business.id, async (tx) => [await listChartTemplates(tx), await chartCountsByTemplate(tx)] as const);
  const added = new Set(templates.map((t) => t.starterKey).filter(Boolean));
  const starters = STARTER_CHART_TEMPLATES.filter((s) => !added.has(s.key));
  const base = `/app/${slug}/settings/charts`;
  return (
    <>
      <div className="mb-2"><BackLink href={`/app/${slug}/settings`}>Settings</BackLink></div>
      <PageHeader title="Chart templates">
        <LinkButton href={`${base}/new`} variant="primary" size="sm"><Plus className="h-4 w-4" /> New template</LinkButton>
      </PageHeader>
      <p className="mb-4 text-sm text-stone-600">What providers record about a treatment, such as a SOAP note. They chart a visit from the appointment, sign it, and the signed chart is locked on the client&apos;s Charts tab. Templates set on a service open first for that service.</p>
      {templates.length ? (
        <Card className="mb-6">
          <ul className="divide-y divide-stone-100 text-sm">
            {templates.map((t) => {
              const n = counts.get(t.id) ?? 0;
              const fieldCount = (t.fields as { type: string }[]).filter((f) => !CHART_DISPLAY_TYPES.includes(f.type as never)).length;
              return (
                <li key={t.id} className={`${rowClass} flex items-center gap-3 px-4 py-3`}>
                  <div className="min-w-0 flex-1">
                    <RowLink href={`${base}/${t.id}`} className={`font-medium ${t.active ? "" : "text-stone-500 line-through"}`}>{t.name}</RowLink>
                    <p className="truncate text-xs text-stone-500">{fieldCount} field{fieldCount === 1 ? "" : "s"} · {t.serviceIds.length ? `opens first for ${t.serviceIds.length} service${t.serviceIds.length === 1 ? "" : "s"}` : "no services set"}{t.active ? "" : " · off"}</p>
                  </div>
                  <span className="w-28 shrink-0 text-right text-xs tabular-nums text-stone-500">{n ? `${n} chart${n === 1 ? "" : "s"}` : "not used yet"}</span>
                </li>
              );
            })}
          </ul>
        </Card>
      ) : null}
      {starters.length ? (
        <section>
          <h2 className="mb-1 text-xs font-semibold uppercase tracking-wide text-stone-500">Starters</h2>
          <p className="mb-3 text-sm text-stone-600">{templates.length ? "Ready to use as they are; add one to change it or set its services." : "Providers can chart with these straight away. Add one to change its fields or choose the services it opens for."}</p>
          <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {starters.map((s) => (
              <li key={s.key}>
                <Link href={`${base}/new?starter=${s.key}`} className="block h-full rounded-xl border border-stone-200 bg-white p-4 transition hover:border-brand-300 hover:bg-brand-50/40">
                  <p className="font-medium text-stone-900">{s.name}</p>
                  <p className="mt-1 text-xs text-stone-500">{s.blurb}</p>
                  <p className="mt-2 text-xs text-brand-700">Add and edit →</p>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </>
  );
}
