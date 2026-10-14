import type { Metadata } from "next";
import { Shell, dateTime } from "@/components";
import { platformHealth } from "@/lib/health";

export const metadata: Metadata = { title: "Health" };
export const dynamic = "force-dynamic";

function Stat({ label, value, bad }: { label: string; value: string | number; bad?: boolean }) {
  return (
    <div className={`rounded-lg border p-3 ${bad ? "border-amber-300 bg-amber-50" : "border-stone-200 bg-white"}`}>
      <div className="text-xs text-stone-500">{label}</div>
      <div className="text-2xl font-semibold tabular-nums">{value}</div>
    </div>
  );
}

export default async function HealthPage() {
  const h = await platformHealth();
  const failed = h.failed24h.reduce((s, r) => s + r.n, 0);
  const max = Math.max(1, ...h.signups.map((s) => s.n));
  return (
    <Shell>
      <h1 className="text-xl font-semibold">Platform health</h1>
      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Messages overdue (15+ min)" value={h.queuedOverdue} bad={h.queuedOverdue > 0} />
        <Stat label="Oldest overdue (minutes)" value={h.oldestQueuedMinutes ?? "—"} bad={(h.oldestQueuedMinutes ?? 0) > 30} />
        <Stat label="Failed messages (24h)" value={failed} bad={failed > 0} />
        <Stat label="Stuck Stripe webhooks" value={h.webhookUnprocessed} bad={h.webhookUnprocessed > 0} />
      </div>
      {h.queuedOverdue > 0 && <p className="mt-2 text-sm text-amber-800">Overdue messages usually mean the reminder cron job isn&apos;t running.</p>}

      <h2 className="mt-6 font-semibold">Most common send errors (7 days)</h2>
      <ul className="mt-2 divide-y divide-stone-100 rounded-lg border border-stone-200 bg-white text-sm">
        {h.topErrors.map((e) => <li key={e.error} className="flex justify-between gap-4 px-3 py-2"><span>{e.error}</span><span className="tabular-nums text-stone-600">{e.n}</span></li>)}
        {h.topErrors.length === 0 && <li className="px-3 py-3 text-stone-500">None.</li>}
      </ul>

      <h2 className="mt-6 font-semibold">Webhook errors (7 days)</h2>
      <ul className="mt-2 divide-y divide-stone-100 rounded-lg border border-stone-200 bg-white text-sm">
        {h.webhookErrors.map((e) => <li key={e.id} className="px-3 py-2"><span className="font-medium">{e.type}</span> <span className="text-stone-500">{dateTime(e.at)}</span><div className="text-red-700">{e.error}</div></li>)}
        {h.webhookErrors.length === 0 && <li className="px-3 py-3 text-stone-500">None.</li>}
      </ul>

      <h2 className="mt-6 font-semibold">New businesses per week</h2>
      <div className="mt-2 flex h-32 items-end gap-1 rounded-lg border border-stone-200 bg-white p-3" role="img" aria-label="Signups per week, last 12 weeks">
        {h.signups.map((s) => (
          <div key={String(s.week)} className="flex flex-1 flex-col items-center justify-end gap-1" title={`${new Date(s.week).toLocaleDateString("en-US", { month: "short", day: "numeric" })}: ${s.n}`}>
            <span className="text-xs tabular-nums text-stone-600">{s.n}</span>
            <div className="w-full rounded-t bg-violet-500" style={{ height: Math.max(2, Math.round((s.n / max) * 70)) }} />
          </div>
        ))}
        {h.signups.length === 0 && <span className="m-auto text-sm text-stone-500">No signups in 12 weeks.</span>}
      </div>
    </Shell>
  );
}
