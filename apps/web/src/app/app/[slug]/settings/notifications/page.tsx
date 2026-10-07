import type { Metadata } from "next";
import { StatusBadge } from "@/components/status-badge";

export const metadata: Metadata = { title: "Messages" };
import { desc } from "drizzle-orm";
import { schema, withTenant } from "@angelic/db";
import { requireAction } from "@/lib/tenant";
import { emailConfigured, smsConfigured } from "@/lib/notify/providers";
import { BackLink, Card, PageHeader, Empty, Notice } from "@/components/ui";

export default async function NotificationsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { business } = await requireAction(slug, "business.manage");
  const rows = await withTenant(business.id, (tx) => tx.select().from(schema.notifications).orderBy(desc(schema.notifications.createdAt)).limit(200));
  const fmt = new Intl.DateTimeFormat("en-US", { dateStyle: "short", timeStyle: "short", timeZone: business.timezone });
  return (
    <>
      <div className="mb-2"><BackLink href={`/app/${slug}/settings`}>Settings</BackLink></div>
      <PageHeader title="Messages" />
      {!emailConfigured() || !smsConfigured() ? (
        <div className="mb-4">
          <Notice>
            {!emailConfigured() ? "Email sending is off (set RESEND_API_KEY and EMAIL_FROM). " : ""}
            {!smsConfigured() ? "SMS sending is off (set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN and TWILIO_FROM). " : ""}
            Messages are still recorded here as “skipped”.
          </Notice>
        </div>
      ) : null}
      {rows.length === 0 ? <Empty title="No messages yet" body="Confirmations, reminders and cancellations will appear here." /> : (
        <Card>
          <div className="overflow-x-auto"><table className="w-full text-sm">
            <thead className="text-left text-xs uppercase tracking-wide text-stone-500"><tr><th className="px-4 py-2">Created</th><th className="px-4 py-2">Channel</th><th className="px-4 py-2">Type</th><th className="px-4 py-2">To</th><th className="px-4 py-2">Scheduled</th><th className="px-4 py-2">Status</th></tr></thead>
            <tbody className="divide-y divide-stone-200">
              {rows.map((n) => (
                <tr key={n.id} className="align-top">
                  <td className="whitespace-nowrap px-4 py-2 text-stone-600">{fmt.format(n.createdAt)}</td>
                  <td className="px-4 py-2 uppercase">{n.channel}</td>
                  <td className="px-4 py-2">{n.template}</td>
                  <td className="px-4 py-2">{n.recipient}</td>
                  <td className="whitespace-nowrap px-4 py-2 text-stone-600">{fmt.format(n.scheduledAt)}</td>
                  <td className="px-4 py-2"><StatusBadge status={n.status} />{n.error ? <span className="block text-xs text-stone-500">{n.error}</span> : null}</td>
                </tr>
              ))}
            </tbody>
          </table></div>
        </Card>
      )}
    </>
  );
}
