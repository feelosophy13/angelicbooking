import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import type { ChartFieldDef } from "@angelic/core";
import { schema, withTenant } from "@angelic/db";
import { requireAction } from "@/lib/tenant";
import { FormPage } from "@/components/ui";
import { ConfirmSubmit } from "@/components/form";
import { serviceTree } from "@/server/service-groups";
import { ChartTemplateEditor } from "../template-editor";
import { deleteChartTemplate, updateChartTemplate } from "../actions";

export const metadata: Metadata = { title: "Chart template" };

export default async function EditChartTemplatePage({ params }: { params: Promise<{ slug: string; templateId: string }> }) {
  const { slug, templateId } = await params;
  const { business } = await requireAction(slug, "forms.manage");
  const [t, tree] = await Promise.all([withTenant(business.id, (tx) => tx.query.chartTemplates.findFirst({ where: eq(schema.chartTemplates.id, templateId) })), serviceTree(business)]);
  if (!t) notFound();
  return (
    <>
      <FormPage title={t.name} backHref={`/app/${slug}/settings/charts`} backLabel="Chart templates" width="max-w-3xl">
        <p className="mb-4 text-xs text-stone-500">Changes apply to new charts. Charts already written keep the fields they were written on.</p>
        <ChartTemplateEditor action={updateChartTemplate} slug={slug} template={{ id: t.id, name: t.name, description: t.description, fields: t.fields as ChartFieldDef[], serviceIds: t.serviceIds, active: t.active }} tree={tree} submitLabel="Save template" />
      </FormPage>
      <form action={deleteChartTemplate} className="mt-4 flex max-w-3xl justify-end">
        <input type="hidden" name="slug" value={slug} />
        <input type="hidden" name="templateId" value={t.id} />
        <ConfirmSubmit title={`Delete ${t.name}?`} body="If charts were written on it, it is switched off instead and those charts are kept." confirmLabel="Delete" variant="ghost" className="text-stone-500 hover:text-red-600">Delete template</ConfirmSubmit>
      </form>
    </>
  );
}
