import type { Metadata } from "next";
import { StatusBadge } from "@/components/status-badge";

export const metadata: Metadata = { title: "Messages" };
import { desc, eq } from "drizzle-orm";
import { schema, withTenant } from "@angelic/db";
import { requireAction } from "@/lib/tenant";
import { emailConfigured, smsConfigured } from "@/lib/notify/providers";
import { BackLink, Card, PageHeader, Empty, Notice, Textarea } from "@/components/ui";
import { ActionForm, Field, SubmitButton } from "@/components/form";
import { SMS_DEFAULTS, SMS_PLACEHOLDERS, SMS_TEMPLATE_KEYS } from "@/lib/notify/sms";
import { listInbox } from "@/server/inbound";
import { resendMessage, saveSmsTemplates } from "./actions";
import { Button } from "@/components/ui";
import Link from "next/link";

export default async function NotificationsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { business } = await requireAction(slug, "business.manage");
  const rows = await withTenant(business.id, (tx) =>
    tx
      .select({ n: schema.notifications, workflowName: schema.workflows.name, workflowId: schema.workflows.id })
      .from(schema.notifications)
      .leftJoin(schema.workflowRuns, eq(schema.workflowRuns.id, schema.notifications.workflowRunId))
      .leftJoin(schema.workflows, eq(schema.workflows.id, schema.workflowRuns.workflowId))
      .orderBy(desc(schema.notifications.createdAt))
      .limit(200),
  );
  const inbox = await listInbox(business.id, 50);
  const LABEL: Record<string, string> = { forms_nudge: "Forms still due (morning of the visit)", confirmation: "Confirmation", reminder: "Reminder", rescheduled: "Rescheduled", cancellation: "Cancellation", review_request: "Review request" };
  const fmt = new Intl.DateTimeFormat("en-US", { dateStyle: "short", timeStyle: "short", timeZone: business.timezone });
  return (
    <>
      <div className="mb-2"><BackLink href={`/app/${slug}/settings`}>Settings</BackLink></div>
      <PageHeader title="Messages" />
      {!emailConfigured() || !smsConfigured() ? (
        <div className="mb-4">
          <Notice>
            {!emailConfigured() ? "Email sending is off (set RESEND_API_KEY and EMAIL_FROM). " : ""}
            {!smsConfigured() ? "Text messaging is not set up on this platform yet. " : ""}
            Messages are still recorded here as “skipped”.
          </Notice>
        </div>
      ) : null}
      <div className="mb-6 grid gap-6 lg:grid-cols-2">
        <Card className="p-4">
          <h2 className="mb-1 font-medium">Text wording</h2>
          <p className="mb-3 text-xs text-stone-500">Leave a box empty to use the default. Placeholders: {SMS_PLACEHOLDERS.join(" ")}. “Reply STOP to opt out” is added automatically to a client&apos;s first text and to every marketing text.</p>
          <ActionForm action={saveSmsTemplates}>
            <input type="hidden" name="slug" value={slug} />
            {SMS_TEMPLATE_KEYS.map((k) => (
              <Field key={k} label={LABEL[k] ?? k} name={`t_${k}`} hint={`Default: ${SMS_DEFAULTS[k]}`}><Textarea name={`t_${k}`} rows={4} defaultValue={business.smsTemplates?.[k] ?? ""} placeholder={SMS_DEFAULTS[k]} /></Field>
            ))}
            <SubmitButton size="sm" pendingText="Saving…">Save wording</SubmitButton>
          </ActionForm>
        </Card>
        <Card>
          <h2 className="border-b border-stone-200 px-4 py-2 text-sm font-semibold text-stone-600">Inbox · replies from clients</h2>
          {inbox.length === 0 ? <p className="p-4 text-sm text-stone-500">No replies yet. Texts clients send to your number land here and on their client page.</p> : (
            <ul className="max-h-96 divide-y divide-stone-100 overflow-y-auto text-sm">
              {inbox.map(({ m, firstName, lastName }) => (
                <li key={m.id} className="px-4 py-2">
                  <div className="flex items-center justify-between gap-2">
                    {m.clientId ? <Link href={`/app/${slug}/clients/${m.clientId}`} className="font-medium hover:underline">{firstName} {lastName}</Link> : <span className="font-medium">{m.fromNumber}</span>}
                    <span className="text-xs text-stone-500">{fmt.format(m.receivedAt)}</span>
                  </div>
                  <p className="text-stone-700">{m.body}</p>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
      {rows.length === 0 ? <Empty title="No messages yet" body="Confirmations, reminders and cancellations will appear here." /> : (
        <Card>
          <div className="overflow-x-auto"><table className="w-full text-sm">
            <thead className="text-left text-xs uppercase tracking-wide text-stone-500"><tr><th className="px-4 py-2">Created</th><th className="px-4 py-2">Channel</th><th className="px-4 py-2">Type</th><th className="px-4 py-2">To</th><th className="px-4 py-2">Scheduled</th><th className="px-4 py-2">Status</th></tr></thead>
            <tbody className="divide-y divide-stone-200">
              {rows.map(({ n, workflowName, workflowId }) => (
                <tr key={n.id} className="align-top">
                  <td className="whitespace-nowrap px-4 py-2 text-stone-600">{fmt.format(n.createdAt)}</td>
                  <td className="px-4 py-2 uppercase">{n.channel}</td>
                  <td className="px-4 py-2">{workflowName ? <Link href={`/app/${slug}/marketing/automations/${workflowId}`} className="hover:underline">{workflowName}</Link> : n.template}</td>
                  <td className="px-4 py-2">{n.recipient}</td>
                  <td className="whitespace-nowrap px-4 py-2 text-stone-600">{fmt.format(n.scheduledAt)}</td>
                  <td className="px-4 py-2">
                    <StatusBadge status={n.status} />
                    {n.error ? <span className="block text-xs text-stone-500">{n.error}</span> : null}
                    {n.status === "failed" || n.status === "skipped" ? (
                      <form action={resendMessage} className="mt-1">
                        <input type="hidden" name="slug" value={slug} />
                        <input type="hidden" name="id" value={n.id} />
                        <Button type="submit" size="sm" variant="secondary">Send again</Button>
                      </form>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table></div>
        </Card>
      )}
    </>
  );
}
