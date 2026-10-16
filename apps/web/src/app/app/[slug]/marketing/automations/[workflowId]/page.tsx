import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireAction } from "@/lib/tenant";
import { getWorkflow, noVisitReach, recentRuns, WORKFLOW_TEMPLATES } from "@/server/workflows";
import { NO_VISIT_WINDOW_DAYS } from "@/lib/workflows-logic";
import { triggerMeta } from "@/lib/workflows-logic";
import { BackLink, Card, PageHeader } from "@/components/ui";
import { ConfirmSubmit } from "@/components/form";
import { StatusBadge } from "@/components/status-badge";
import { WorkflowForm } from "../workflow-form";
import { loadPickers } from "../pickers";
import { deleteWorkflowAction, duplicateWorkflowAction } from "../actions";

export const metadata: Metadata = { title: "Edit workflow" };

export default async function EditWorkflowPage({ params }: { params: Promise<{ slug: string; workflowId: string }> }) {
  const { slug, workflowId } = await params;
  const { business } = await requireAction(slug, "business.manage");
  const [w, pickers, runs] = await Promise.all([getWorkflow(business.id, workflowId), loadPickers(business.id), recentRuns(business.id, workflowId)]);
  if (!w) notFound();
  const reach = w.trigger === "no_visit" ? await noVisitReach(business, w) : null;
  const fmt = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: business.timezone });
  const fmtIso = (iso: string) => fmt.format(new Date(iso));
  return (
    <>
      <div className="mb-2"><BackLink href={`/app/${slug}/marketing/automations`}>Automations</BackLink></div>
      <PageHeader title={w.name}>
        <form action={duplicateWorkflowAction}><input type="hidden" name="slug" value={slug} /><input type="hidden" name="workflowId" value={w.id} /><button type="submit" className="rounded-lg border border-stone-300 bg-white px-3 py-1.5 text-sm hover:bg-stone-50">Duplicate</button></form>
        {!w.templateKey || !WORKFLOW_TEMPLATES.some((t) => t.key === w.templateKey) ? (
          <form action={deleteWorkflowAction}><input type="hidden" name="slug" value={slug} /><input type="hidden" name="workflowId" value={w.id} /><ConfirmSubmit title={`Delete “${w.name}”?`} body="Runs in progress are dropped. This can't be undone." confirmLabel="Delete" variant="ghost" className="text-stone-500 hover:text-red-600">Delete</ConfirmSubmit></form>
        ) : null}
      </PageHeader>
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_20rem]">
        <Card className="overflow-hidden p-5"><WorkflowForm slug={slug} workflow={w} trigger={w.trigger} pickers={pickers} /></Card>
        <Card className="h-fit p-4 text-sm">
          {reach !== null ? (
            <p className="mb-3 rounded-lg bg-stone-50 p-2 text-xs text-stone-600">
              Reaches clients whose last visit was {w.filters.days ?? 60} to {(w.filters.days ?? 60) + NO_VISIT_WINDOW_DAYS} days ago, once each, so turning it on never messages everyone who ever lapsed. {w.enabled ? "At the next daily check" : "If turned on now"}: <b>{reach}</b> {reach === 1 ? "client" : "clients"}.
            </p>
          ) : null}
          <h2 className="mb-1 font-medium">Recent runs</h2>
          <p className="mb-3 text-xs text-stone-500">{triggerMeta(w.trigger).label}{w.templateKey ? " · built-in" : " · custom"}. One run per client per occasion.</p>
          {runs.length === 0 ? <p className="text-xs text-stone-500">Nothing has started this workflow yet.</p> : (
            <ul className="space-y-3">
              {runs.map(({ run, firstName, lastName }) => (
                <li key={run.id} className="rounded-lg border border-stone-100 p-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium">{firstName ? `${firstName} ${lastName ?? ""}`.trim() : "Client"}</span>
                    <StatusBadge status={run.status === "active" ? "queued" : run.status === "done" ? "sent" : "cancelled"} />
                  </div>
                  <p className="text-[11px] text-stone-400">{fmt.format(run.startedAt)}{run.nextAt && run.status === "active" ? ` · next ${fmt.format(run.nextAt)}` : ""}</p>
                  <ul className="mt-1 space-y-0.5 text-[11px] text-stone-600">
                    {run.log.slice(-6).map((l, i) => <li key={i}><span className="text-stone-400">{fmtIso(l.at)}</span> {l.step != null ? `step ${l.step + 1}: ` : ""}{l.detail}</li>)}
                  </ul>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}
