import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { ChartError, CHART_DISPLAY_TYPES, type ChartAnswers, type ChartFieldDef } from "@angelic/core";
import { schema, withTenant } from "@angelic/db";
import { PermissionError, requireAnyAction } from "@/lib/tenant";
import { AutoSubmitForm } from "@/components/auto-submit-form";
import { FormPage, Select } from "@/components/ui";
import { Field } from "@/components/form";
import { canChartClient, chartPhotos, chartTemplateChoices, chartVisit, lastChartForService } from "@/server/charts";
import { ChartEditor } from "../chart-editor";
import { LastTime } from "../parts";

export const metadata: Metadata = { title: "New chart" };

type SP = { clientId?: string; appointmentId?: string; serviceId?: string; template?: string; copy?: string };

/**
 * "Chart this visit" (from the appointment) or "New chart" (from the client's Charts tab). Opens on the template set on the service, with
 * the client's last chart for the same service folded away above it. Nothing is saved until Save draft or Sign.
 */
export default async function NewChartPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<SP> }) {
  const { slug } = await params;
  const sp = await searchParams;
  const ctx = await requireAnyAction(slug, "charts.write.own", "charts.write.any");
  if (!sp.clientId) notFound();
  const data = await withTenant(ctx.business.id, async (tx) => {
    const client = await tx.query.clients.findFirst({ where: eq(schema.clients.id, sp.clientId!), columns: { id: true, firstName: true, lastName: true } });
    if (!client) return null;
    if (!(await canChartClient(tx, ctx, client.id, "write"))) throw new PermissionError();
    const visit = await chartVisit(tx, client.id, sp.appointmentId ?? null, sp.serviceId ?? null).catch((e) => { if (e instanceof ChartError) return null; throw e; });
    const svcId = visit?.item?.serviceId ?? (visit ? null : sp.serviceId ?? null);
    const service = svcId ? await tx.query.services.findFirst({ where: eq(schema.services.id, svcId), columns: { id: true, name: true } }) : null;
    const { choices, preferred } = await chartTemplateChoices(tx, service ?? null);
    const chosen = choices.find((c) => c.value === sp.template) ?? choices.find((c) => c.value === preferred) ?? choices[0]!;
    const last = await lastChartForService(tx, client.id, service?.id ?? null);
    const photos = await chartPhotos(tx, visit?.id ?? null);
    return { client, visit, service, choices, chosen, last, photos };
  });
  if (!data) notFound();
  const { client, visit, service, choices, chosen, last, photos } = data;
  const name = `${client.firstName} ${client.lastName}`.trim();
  const back = visit ? { href: `/app/${slug}/appointments/${visit.id}`, label: "Appointment" } : { href: `/app/${slug}/clients/${client.id}/charts`, label: `${name}'s charts` };
  const keep = (extra: Record<string, string | null | undefined>) => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries({ clientId: client.id, appointmentId: visit?.id, serviceId: service?.id, template: chosen.value, ...extra })) if (v) q.set(k, v);
    return `/app/${slug}/charts/new?${q}`;
  };
  // "Start from its answers": the last chart's answers, when it was written on the same template (photos stay with their own visit).
  const sameTemplate = !!last && (last.templateId ? last.templateId === chosen.templateId : last.templateSnapshot.name === chosen.name);
  const copied: ChartAnswers = {};
  if (sameTemplate && sp.copy === last!.id) {
    for (const f of chosen.fields) {
      const v = (last!.answers as ChartAnswers)[f.id];
      if (v !== undefined && f.type !== "photo" && !CHART_DISPLAY_TYPES.includes(f.type)) copied[f.id] = v;
    }
  }
  const items = visit?.items.filter((i, k, all) => i.serviceId && all.findIndex((x) => x.serviceId === i.serviceId) === k) ?? [];
  return (
    <FormPage title={`Chart for ${name}`} backHref={back.href} backLabel={back.label} width="max-w-3xl">
      <AutoSubmitForm className="mb-5 grid gap-3 sm:grid-cols-2">
        <input type="hidden" name="clientId" value={client.id} />
        {visit ? <input type="hidden" name="appointmentId" value={visit.id} /> : null}
        {items.length > 1 ? (
          <Field label="Service" name="serviceId">
            <Select name="serviceId" defaultValue={service?.id ?? ""}>
              {items.map((i) => <option key={i.serviceId} value={i.serviceId!}>{i.serviceName.replace(/ \(finish\)$/, "")}</option>)}
            </Select>
          </Field>
        ) : service ? <input type="hidden" name="serviceId" value={service.id} /> : null}
        <Field label="Chart" name="template">
          <Select name="template" defaultValue={chosen.value}>
            {choices.map((c) => <option key={c.value} value={c.value}>{c.name}</option>)}
          </Select>
        </Field>
      </AutoSubmitForm>
      {service || visit ? <p className="-mt-2 mb-4 text-sm text-stone-600">{[service?.name, visit?.item ? new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeZone: ctx.business.timezone }).format(visit.item.startAt) : null].filter(Boolean).join(" · ")}</p> : null}
      {chosen.description ? <p className="mb-4 whitespace-pre-line text-sm text-stone-600">{chosen.description}</p> : null}
      <LastTime slug={slug} note={last} timeZone={ctx.business.timezone} copyHref={sameTemplate && sp.copy !== last?.id ? keep({ copy: last!.id }) : null} />
      {sp.copy && Object.keys(copied).length ? <p className="mb-4 rounded-lg bg-stone-50 px-3 py-2 text-xs text-stone-600">Filled in from the last chart. Check each answer is still right for today.</p> : null}
      <ChartEditor
        key={`${chosen.value}:${sp.copy ?? ""}`}
        slug={slug}
        hidden={{ clientId: client.id, appointmentId: visit?.id ?? "", serviceId: service?.id ?? "", template: chosen.value }}
        fields={chosen.fields as ChartFieldDef[]}
        answers={copied}
        photos={photos.map((p) => ({ id: p.id, thumbUrl: `/api/files/${p.thumbFileId ?? p.fileId}`, phase: p.phase }))}
        photosHref={visit ? `/app/${slug}/appointments/${visit.id}#photos` : null}
        signerName={ctx.user.name}
      />
    </FormPage>
  );
}
