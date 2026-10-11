import type { Metadata } from "next";
import Link from "next/link";
import type { WorkflowTrigger } from "@angelic/db";
import { requireAction } from "@/lib/tenant";
import { TRIGGERS } from "@/lib/workflows-logic";
import { BackLink, Card, PageHeader } from "@/components/ui";
import { WorkflowForm } from "../workflow-form";
import { loadPickers } from "../pickers";

export const metadata: Metadata = { title: "New workflow" };

/** Step 1 picks the trigger (it decides which waits, filters and placeholders make sense); step 2 is the form. */
export default async function NewWorkflowPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ trigger?: string }> }) {
  const { slug } = await params;
  const sp = await searchParams;
  const { business } = await requireAction(slug, "business.manage");
  const trigger = TRIGGERS.find((t) => t.key === sp.trigger)?.key as WorkflowTrigger | undefined;
  const base = `/app/${slug}/marketing/automations`;
  if (!trigger) {
    const groups: { key: "visit" | "client" | "schedule"; title: string }[] = [{ key: "visit", title: "Around a visit" }, { key: "client", title: "Something a client did" }, { key: "schedule", title: "On a schedule" }];
    return (
      <>
        <div className="mb-2"><BackLink href={base}>Automations</BackLink></div>
        <PageHeader title="New workflow" />
        <p className="mb-4 text-sm text-stone-600">What should start it?</p>
        <div className="space-y-6">
          {groups.map((g) => (
            <section key={g.key}>
              <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-stone-500">{g.title}</h2>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {TRIGGERS.filter((t) => t.group === g.key).map((t) => (
                  <Link key={t.key} href={`${base}/new?trigger=${t.key}`} className="rounded-xl border border-stone-200 bg-white p-4 shadow-sm transition hover:border-brand-300 hover:shadow">
                    <p className="font-medium">{t.label}</p>
                    <p className="mt-1 text-xs text-stone-500">{t.description}</p>
                  </Link>
                ))}
              </div>
            </section>
          ))}
        </div>
      </>
    );
  }
  const pickers = await loadPickers(business.id);
  return (
    <>
      <div className="mb-2"><BackLink href={`${base}/new`}>Choose a different trigger</BackLink></div>
      <PageHeader title="New workflow" />
      <Card className="max-w-4xl p-5"><WorkflowForm slug={slug} workflow={null} trigger={trigger} pickers={pickers} /></Card>
    </>
  );
}
