import type { Metadata } from "next";
import { starterChartTemplate, type ChartFieldDef } from "@angelic/core";
import { requireAction } from "@/lib/tenant";
import { FormPage } from "@/components/ui";
import { serviceTree, type ServiceTreeNode } from "@/server/service-groups";
import { ChartTemplateEditor } from "../template-editor";
import { createChartTemplate } from "../actions";

export const metadata: Metadata = { title: "New chart template" };

const flatten = (nodes: ServiceTreeNode[]): { id: string; name: string }[] => nodes.flatMap((n) => [...n.services, ...flatten(n.children)]);

/** A new template, blank or from a starter (`?starter=`), which also ticks the services whose names suit it. */
export default async function NewChartTemplatePage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ starter?: string }> }) {
  const { slug } = await params;
  const { starter } = await searchParams;
  const { business } = await requireAction(slug, "forms.manage");
  const tree = await serviceTree(business);
  const s = starterChartTemplate(starter);
  const initial = s ? { name: s.name, description: null, fields: s.fields as ChartFieldDef[], serviceIds: s.servicePattern ? flatten(tree).filter((x) => s.servicePattern!.test(x.name)).map((x) => x.id) : [], active: true, starterKey: s.key } : null;
  return (
    <FormPage title={s ? s.name : "New chart template"} backHref={`/app/${slug}/settings/charts`} backLabel="Chart templates" width="max-w-3xl">
      {s ? <p className="mb-4 rounded-lg border border-brand-100 bg-brand-50/60 px-3 py-2 text-xs text-stone-700">Started from a starter. Change the fields to how your team works; charts already written keep the version they were written on.</p> : null}
      <ChartTemplateEditor action={createChartTemplate} slug={slug} template={initial} tree={tree} submitLabel="Add template" />
    </FormPage>
  );
}
