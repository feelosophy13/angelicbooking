import type { Metadata } from "next";
import Link from "next/link";
import { asc, eq } from "drizzle-orm";
import { FileText } from "lucide-react";
import { schema, withTenant } from "@angelic/db";
import { requireAction } from "@/lib/tenant";
import { listLocations } from "@/server/locations";
import { FormPage } from "@/components/ui";
import { FORM_TEMPLATES, formTemplate } from "@/lib/form-templates";
import { FormEditor } from "../form-editor";
import { createForm } from "../actions";

export const metadata: Metadata = { title: "New form" };

/** Pick a template (or start blank), then edit it like any other form. */
export default async function NewFormPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ template?: string }> }) {
  const { slug } = await params;
  const { template } = await searchParams;
  const { business } = await requireAction(slug, "business.manage");
  const t = template === "blank" ? "blank" : formTemplate(template);
  if (!t) {
    return (
      <FormPage title="New form" backHref={`/app/${slug}/settings/forms`} backLabel="Forms" width="max-w-3xl">
        <p className="mb-4 text-sm text-stone-600">Start from a template and change anything, or build one from scratch.</p>
        <ul className="grid gap-3 sm:grid-cols-2">
          {FORM_TEMPLATES.map((tpl) => (
            <li key={tpl.key}>
              <Link href={`/app/${slug}/settings/forms/new?template=${tpl.key}`} className="block h-full rounded-xl border border-stone-200 bg-white p-4 transition hover:border-brand-300 hover:bg-brand-50/40">
                <p className="flex items-center gap-2 font-medium text-stone-900"><FileText className="h-4 w-4 text-stone-400" /> {tpl.name}</p>
                <p className="mt-1 text-xs text-stone-500">{tpl.blurb}</p>
                <p className="mt-2 text-[11px] uppercase tracking-wide text-stone-400">{tpl.kind === "consent" ? "Consent" : "Intake"} · {tpl.fields.filter((f) => f.type !== "statement" && f.type !== "heading").length} questions</p>
              </Link>
            </li>
          ))}
          <li>
            <Link href={`/app/${slug}/settings/forms/new?template=blank`} className="flex h-full items-center justify-center rounded-xl border border-dashed border-stone-300 p-4 text-sm text-stone-600 hover:bg-stone-50">Start from scratch</Link>
          </li>
        </ul>
      </FormPage>
    );
  }
  const services = await withTenant(business.id, (tx) => tx.select({ id: schema.services.id, name: schema.services.name }).from(schema.services).where(eq(schema.services.active, true)).orderBy(asc(schema.services.name)));
  const initial = t === "blank" ? null : { name: t.name, kind: t.kind, description: t.description, fields: t.fields, requireSignature: t.requireSignature, applyToAll: t.applyToAll, serviceIds: [], renewDays: t.renewDays, active: true };
  return (
    <FormPage title={t === "blank" ? "New form" : t.name} backHref={`/app/${slug}/settings/forms/new`} backLabel="Templates" width="max-w-3xl">
      <FormEditor action={createForm} slug={slug} form={initial} services={services} locations={await listLocations(business.id)} submitLabel="Create form" />
    </FormPage>
  );
}
