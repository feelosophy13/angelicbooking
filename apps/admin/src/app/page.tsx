import Link from "next/link";
import { date } from "@/components";
import { Shell } from "@/components";
import { needsAttention } from "@/lib/attention";
import { actionLabel, listAudit } from "@/lib/audit";
import { platformHealth } from "@/lib/health";
import { platformWeekly, weekLabel } from "@/lib/metrics";
import { money } from "@/lib/price-form";
import { listTenantsWithBills } from "@/lib/tenants";
import { Bars, Sparkline, Stack } from "@/ui/chart";
import { Icon } from "@/ui/icons";
import { Avatar, Badge, Card, Empty, PageHeader, Stat, relativeDay } from "@/ui/kit";

export const dynamic = "force-dynamic";

export default async function Dashboard() {
  const [{ tenants }, weekly, audit, health] = await Promise.all([listTenantsWithBills(), platformWeekly(), listAudit({ limit: 6 }), platformHealth()]);
  const now = Date.now();
  const live = tenants.filter((t) => !t.suspendedAt);
  const paying = live.filter((t) => t.subscriptionStatus === "active").length;
  const trial = live.filter((t) => t.subscriptionStatus === "trialing" || (t.plan === "trial" && t.subscriptionStatus === "none")).length;
  const failing = live.filter((t) => ["past_due", "unpaid"].includes(t.subscriptionStatus)).length;
  const suspended = tenants.length - live.length;
  const comped = tenants.filter((t) => t.comped).length;
  const other = Math.max(0, live.length - paying - trial - failing);
  const estimated = tenants.reduce((s, t) => s + t.bill.totalCents, 0);
  const attention = needsAttention(tenants, now);
  const thisWeek = weekly[weekly.length - 1];
  const sum = (k: "bookings" | "sms" | "signups" | "clients") => weekly.reduce((s, w) => s + w[k], 0);
  const spark = (k: "bookings" | "sms" | "signups" | "clients", label: string) => <Sparkline values={weekly.map((w) => w[k])} label={label} />;
  const overdue = health.queuedOverdue > 0 || health.webhookUnprocessed > 0 || health.failed24h.reduce((s, r) => s + r.n, 0) > 0;
  const recent = [...tenants].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()).slice(0, 5);

  return (
    <Shell>
      <PageHeader
        title="Dashboard"
        subtitle={`${tenants.length} businesses · ${new Date(now).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}`}
        actions={<Link href="/tenants" className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-surface px-3 py-1.5 text-sm font-medium hover:bg-surface-2">All businesses <Icon name="arrow" /></Link>}
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Businesses" value={tenants.length} hint={`${thisWeek?.signups ?? 0} new this week · ${sum("signups")} in 12 weeks`} spark={spark("signups", "New businesses per week")} href="/tenants" />
        <Stat label="Est. monthly revenue" value={money(estimated)} hint={`If every business paid its listed price${comped ? ` · ${comped} comped` : ""}`} href="/pricing" />
        <Stat label="Bookings made" value={sum("bookings").toLocaleString()} hint="Last 12 weeks, all businesses" spark={spark("bookings", "Bookings per week")} />
        <Stat label="Texts sent" value={sum("sms").toLocaleString()} hint="Last 12 weeks" spark={spark("sms", "Texts per week")} />
      </div>

      <div className="mt-6 grid grid-cols-[minmax(0,1fr)] gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="space-y-6">
          <Card title="Needs attention" aside={attention.length ? `${attention.length} business${attention.length === 1 ? "" : "es"}` : undefined} pad={false}>
            {attention.length === 0 ? (
              <div className="p-4"><Empty title="Nothing needs you right now">Failing payments, ending trials, stalled setups and quiet businesses show up here.</Empty></div>
            ) : (
              <ul className="divide-y divide-line">
                {attention.slice(0, 8).map((a) => (
                  <li key={a.tenant.id} className="relative flex items-center gap-3 px-4 py-3 hover:bg-surface-2">
                    <Avatar name={a.tenant.name} size={32} />
                    <div className="min-w-0 flex-1">
                      <Link href={`/tenants/${a.tenant.id}`} className="font-medium after:absolute after:inset-0">{a.tenant.name}</Link>
                      <div className="truncate text-xs text-ink-2">{a.reason}</div>
                    </div>
                    <Badge tone={a.tone}>{a.tone === "bad" ? "Urgent" : a.tone === "warn" ? "Soon" : a.tone === "info" ? "Heads up" : "FYI"}</Badge>
                  </li>
                ))}
              </ul>
            )}
            {attention.length > 8 && <div className="border-t border-line px-4 py-2.5 text-sm"><Link href="/tenants" className="text-brand hover:underline">See all {attention.length} in Businesses</Link></div>}
          </Card>

          <Card title="Bookings made per week" aside="Last 12 weeks, all businesses">
            <Bars label="Bookings made per week" data={weekly.map((w) => ({ label: weekLabel(w.week), value: w.bookings }))} />
          </Card>
        </div>

        <div className="space-y-6">
          <Card title="Where businesses stand">
            <Stack
              label="Businesses by status"
              parts={[
                { label: "Paying", value: paying, color: "var(--good)" },
                { label: "On trial", value: trial, color: "var(--info)" },
                { label: "Payment failing", value: failing, color: "var(--bad)" },
                { label: "Other", value: other, color: "var(--ink-3)" },
                { label: "Suspended", value: suspended, color: "var(--warn)" },
              ]}
            />
          </Card>

          <Card title="Platform health" aside={<Link href="/health" className="text-brand hover:underline">Details</Link>}>
            <div className="flex items-center gap-2">
              <span className={`h-2.5 w-2.5 rounded-full ${overdue ? "bg-warn" : "bg-good"}`} />
              <span className="text-sm font-medium">{overdue ? "Something needs a look" : "All quiet"}</span>
            </div>
            <dl className="mt-3 space-y-1.5 text-sm">
              <div className="flex justify-between"><dt className="text-ink-2">Messages overdue</dt><dd className="tabular-nums">{health.queuedOverdue}</dd></div>
              <div className="flex justify-between"><dt className="text-ink-2">Failed (24h)</dt><dd className="tabular-nums">{health.failed24h.reduce((s, r) => s + r.n, 0)}</dd></div>
              <div className="flex justify-between"><dt className="text-ink-2">Stuck webhooks</dt><dd className="tabular-nums">{health.webhookUnprocessed}</dd></div>
            </dl>
          </Card>

          <Card title="Newest businesses" pad={false}>
            <ul className="divide-y divide-line">
              {recent.map((t) => (
                <li key={t.id} className="relative flex items-center gap-3 px-4 py-2.5 hover:bg-surface-2">
                  <Avatar name={t.name} size={28} />
                  <div className="min-w-0 flex-1">
                    <Link href={`/tenants/${t.id}`} className="block truncate text-sm font-medium after:absolute after:inset-0">{t.name}</Link>
                    <div className="text-xs text-ink-3">{relativeDay(t.createdAt, now)}</div>
                  </div>
                </li>
              ))}
            </ul>
          </Card>

          <Card title="Recent changes" aside={<Link href="/activity" className="text-brand hover:underline">All</Link>} pad={false}>
            {audit.length === 0 ? (
              <div className="p-4 text-sm text-ink-3">Nothing changed from this app yet.</div>
            ) : (
              <ul className="divide-y divide-line">
                {audit.map((a) => (
                  <li key={a.id} className="px-4 py-2.5 text-sm">
                    <div className="font-medium">{actionLabel(a.action)}{a.businessName ? ` · ${a.businessName}` : ""}</div>
                    <div className="text-xs text-ink-3">{a.actor} · {date(a.at)}</div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>
    </Shell>
  );
}
