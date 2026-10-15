import type { Metadata } from "next";
import { Shell, dateTime } from "@/components";
import { platformHealth } from "@/lib/health";
import { waiting, waitingShort } from "@/lib/audit-text";
import { Bars } from "@/ui/chart";
import { Badge, Card, Empty, PageHeader, Stat } from "@/ui/kit";

export const metadata: Metadata = { title: "Health" };
export const dynamic = "force-dynamic";

export default async function HealthPage() {
  const h = await platformHealth();
  const failed = h.failed24h.reduce((s, r) => s + r.n, 0);
  const bad = h.queuedOverdue > 0 || failed > 0 || h.webhookUnprocessed > 0 || h.webhookErrors.length > 0;
  return (
    <Shell>
      <PageHeader title="Platform health" subtitle={<span className="inline-flex items-center gap-2"><span className={`h-2.5 w-2.5 rounded-full ${bad ? "bg-warn" : "bg-good"}`} />{bad ? "Something needs a look" : "Everything is running"}</span>} />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Messages overdue" value={h.queuedOverdue} hint="Queued 15+ minutes ago" tone={h.queuedOverdue > 0 ? "warn" : undefined} />
        <Stat label="Oldest overdue" value={h.oldestQueuedMinutes == null ? "—" : waitingShort(h.oldestQueuedMinutes)} hint={h.oldestQueuedMinutes != null && h.oldestQueuedMinutes >= 60 ? `Waiting ${waiting(h.oldestQueuedMinutes)}` : "Waiting so far"} tone={(h.oldestQueuedMinutes ?? 0) > 30 ? "warn" : undefined} />
        <Stat label="Failed messages" value={failed} hint="Last 24 hours" tone={failed > 0 ? "warn" : undefined} />
        <Stat label="Stuck webhooks" value={h.webhookUnprocessed} hint="Unprocessed 10+ minutes" tone={h.webhookUnprocessed > 0 ? "warn" : undefined} />
      </div>
      {h.queuedOverdue > 0 && <p className="mt-3 text-sm text-warn">Overdue messages usually mean the reminder cron job isn&apos;t running.</p>}

      <div className="mt-6 grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-2">
        <Card title="Most common send errors" aside="Last 7 days" pad={false}>
          {h.topErrors.length === 0 ? <div className="p-4"><Empty title="No failed sends" /></div> : (
            <ul className="divide-y divide-line text-sm">
              {h.topErrors.map((e) => <li key={e.error} className="flex justify-between gap-4 px-4 py-2.5"><span className="min-w-0 break-words">{e.error}</span><Badge tone="warn">{e.n}</Badge></li>)}
            </ul>
          )}
        </Card>
        <Card title="Webhook errors" aside="Last 7 days" pad={false}>
          {h.webhookErrors.length === 0 ? <div className="p-4"><Empty title="No webhook errors" /></div> : (
            <ul className="divide-y divide-line text-sm">
              {h.webhookErrors.map((e) => <li key={e.id} className="px-4 py-2.5"><div className="flex justify-between gap-3"><span className="font-medium">{e.type}</span><span className="text-xs text-ink-3">{dateTime(e.at)}</span></div><div className="mt-0.5 break-words text-bad">{e.error}</div></li>)}
            </ul>
          )}
        </Card>
        <div className="lg:col-span-2">
          <Card title="New businesses per week" aside="Last 12 weeks">
            <Bars label="New businesses per week" data={h.signups.map((s) => ({ label: new Date(s.week).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" }), value: s.n }))} />
          </Card>
        </div>
      </div>
    </Shell>
  );
}
