import type { Metadata } from "next";
import Link from "next/link";
import { desc, eq } from "drizzle-orm";
import { schema, withTenant } from "@angelic/db";
import { requireAction } from "@/lib/tenant";
import { emailConfigured, smsConfigured } from "@/lib/notify/providers";
import { Button, Card, Empty, Notice, PageHeader } from "@/components/ui";
import { StatusBadge } from "@/components/status-badge";
import { resendMessage } from "./actions";

export const metadata: Metadata = { title: "Messages" };

/** Texts and emails sent to clients, every one with its delivery status. Replies from clients are in the Inbox; wording is in settings. */
export default async function MessagesPage({ params }: { params: Promise<{ slug: string }> }) {
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
  const fmt = new Intl.DateTimeFormat("en-US", { dateStyle: "short", timeStyle: "short", timeZone: business.timezone });
  return (
    <>
      <PageHeader title="Messages">
        <Link href={`/app/${slug}/inbox`} className="text-sm text-brand-700 underline">Replies are in the Inbox</Link>
        <Link href={`/app/${slug}/settings/notifications`} className="text-sm text-brand-700 underline">Text wording</Link>
      </PageHeader>
      {!emailConfigured() || !smsConfigured() ? (
        <div className="mb-4">
          <Notice>
            {!emailConfigured() ? "Email sending is off (set RESEND_API_KEY and EMAIL_FROM). " : ""}
            {!smsConfigured() ? "Text messaging is not set up on this platform yet. " : ""}
            Messages are still recorded here as “skipped”.
          </Notice>
        </div>
      ) : null}
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
                    <StatusBadge status={n.status === "sent" && n.deliveryStatus === "delivered" ? "delivered" : n.status} />
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
