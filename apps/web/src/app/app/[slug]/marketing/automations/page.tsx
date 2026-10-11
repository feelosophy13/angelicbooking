import type { Metadata } from "next";
import Link from "next/link";
import { Plus } from "lucide-react";
import { can } from "@angelic/core";
import { requireAction } from "@/lib/tenant";
import { listWorkflows, templateGroup, type WorkflowTemplate } from "@/server/workflows";
import { smsAvailableFor } from "@/server/messaging";
import { summarizeSteps, triggerMeta } from "@/lib/workflows-logic";
import { Button, Card, Input, LinkButton, PageHeader } from "@/components/ui";
import { ActionForm, Field, SubmitButton } from "@/components/form";
import { saveReminderHours } from "../actions";
import { toggleWorkflow } from "./actions";

export const metadata: Metadata = { title: "Automations" };

const GROUPS: { key: WorkflowTemplate["group"]; title: string; blurb: string }[] = [
  { key: "before", title: "Before the visit", blurb: "Confirmation and reminder always go out; add anything else that should reach clients ahead of time." },
  { key: "after", title: "After the visit", blurb: "Ratings, aftercare and rebooking." },
  { key: "touch", title: "Keep in touch", blurb: "New clients, birthdays, lapsed clients and memberships." },
  { key: "team", title: "For your team", blurb: "Alerts to you or the provider rather than the client." },
];

export default async function AutomationsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { business, permissions } = await requireAction(slug, "reports.view");
  const [flows, sms] = await Promise.all([listWorkflows(business), smsAvailableFor(business.id)]);
  const manage = can(permissions, "business.manage");
  const base = `/app/${slug}/marketing/automations`;
  const usesSms = (steps: { type: string }[]) => steps.some((s) => s.type === "sms");
  return (
    <div className="space-y-8">
      <PageHeader title="Automations" />
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="max-w-2xl text-sm text-stone-600">Each automation is a workflow: it starts on an event, checks a few conditions, then runs its steps in order (waits, texts, emails, tags, points, alerts). Every business starts with the set below; edit them or add your own. Consent, opt-outs, quiet hours and once-per-occasion limits are enforced automatically.</p>
        {manage ? <LinkButton href={`${base}/new`} variant="primary" size="sm"><Plus className="h-4 w-4" /> New workflow</LinkButton> : null}
      </div>
      {!sms ? <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">Text steps are skipped until you have a verified text number; email steps still go out. <Link href={`/app/${slug}/settings/messaging`} className="underline">Get a text number</Link>.</p> : null}
      {GROUPS.map((g) => {
        const mine = flows.filter((w) => templateGroup(w) === g.key);
        return (
          <section key={g.key}>
            <h2 className="mb-1 text-sm font-semibold uppercase tracking-wide text-stone-500">{g.title}</h2>
            <p className="mb-3 text-sm text-stone-600">{g.blurb}</p>
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {g.key === "before" ? (
                <>
                  <Card className="p-4">
                    <div className="mb-1 flex items-center justify-between"><h3 className="font-medium">Confirmation</h3><span className="rounded-full bg-stone-100 px-2 py-0.5 text-[11px] font-medium text-stone-600">Always on</span></div>
                    <p className="text-xs text-stone-500">Sent when an appointment is booked, by email and text (to clients who opted in), with the manage link, deposit and any forms to complete.</p>
                    <p className="mt-2 text-xs text-stone-600">Wording: <Link href={`/app/${slug}/settings/notifications`} className="text-brand-700 underline">Settings → Messages</Link>.</p>
                  </Card>
                  <Card className="p-4">
                    <div className="mb-1 flex items-center justify-between"><h3 className="font-medium">Reminder</h3><span className="rounded-full bg-stone-100 px-2 py-0.5 text-[11px] font-medium text-stone-600">Always on</span></div>
                    <p className="mb-2 text-xs text-stone-500">Before each appointment by email and text; moves with the appointment and is dropped when it is cancelled.</p>
                    {manage ? (
                      <ActionForm action={saveReminderHours} className="space-y-2">
                        <input type="hidden" name="slug" value={slug} />
                        <Field label="Hours before" name="reminderHours"><Input name="reminderHours" type="number" min={1} max={168} defaultValue={business.reminderHours} className="h-9 w-28" /></Field>
                        <SubmitButton size="sm" variant="secondary" pendingText="Saving…">Save</SubmitButton>
                      </ActionForm>
                    ) : <p className="text-sm">{business.reminderHours} hours before</p>}
                  </Card>
                </>
              ) : null}
              {mine.map((w) => (
                <Card key={w.id} className={`flex flex-col p-4 ${w.enabled ? "" : "opacity-80"}`}>
                  <div className="mb-1 flex items-start justify-between gap-2">
                    <h3 className="font-medium"><Link href={`${base}/${w.id}`} className="hover:underline">{w.name}</Link></h3>
                    <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${w.enabled ? "bg-green-50 text-green-700" : "bg-stone-100 text-stone-500"}`}>{w.enabled ? "On" : "Off"}</span>
                  </div>
                  {w.description ? <p className="text-xs text-stone-500">{w.description}</p> : null}
                  <p className="mt-2 text-xs text-stone-700"><span className="font-medium">{triggerMeta(w.trigger).label}</span> → {summarizeSteps(w.steps) || "no steps"}</p>
                  {!sms && usesSms(w.steps) ? <p className="mt-1 text-[11px] text-amber-700">Text steps skipped until a number is verified.</p> : null}
                  <p className="mt-2 text-[11px] text-stone-400">{w.sent30} sent in the last 30 days{w.active ? ` · ${w.active} in progress` : ""}{w.templateKey ? "" : " · custom"}</p>
                  {manage ? (
                    <div className="mt-3 flex items-center gap-2 border-t border-stone-100 pt-3">
                      <form action={toggleWorkflow}>
                        <input type="hidden" name="slug" value={slug} />
                        <input type="hidden" name="workflowId" value={w.id} />
                        <input type="hidden" name="enabled" value={w.enabled ? "false" : "true"} />
                        <Button type="submit" size="sm" variant={w.enabled ? "ghost" : "primary"}>{w.enabled ? "Turn off" : "Turn on"}</Button>
                      </form>
                      <LinkButton href={`${base}/${w.id}`} size="sm">Edit steps</LinkButton>
                    </div>
                  ) : null}
                </Card>
              ))}
            </div>
          </section>
        );
      })}
      <p className="text-xs text-stone-500">Every message sent by a workflow is listed under <Link href={`/app/${slug}/settings/notifications`} className="underline">Settings → Messages</Link> with the workflow that sent it; each workflow's page shows its recent runs and why each step did or didn't send.</p>
    </div>
  );
}
