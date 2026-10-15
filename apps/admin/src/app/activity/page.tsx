import type { Metadata } from "next";
import Link from "next/link";
import { Shell, dateTime } from "@/components";
import { actionLabel, listAudit } from "@/lib/audit";
import { pricingChanges } from "@/lib/audit-text";
import { Badge, Card, Empty, PageHeader, type Tone } from "@/ui/kit";

export const metadata: Metadata = { title: "Activity" };
export const dynamic = "force-dynamic";

const TONE: Record<string, Tone> = { "tenant.suspend": "warn", "tenant.reactivate": "good", "tenant.comp": "info", "tenant.uncomp": "neutral", "tenant.trial.extend": "info" };

export default async function ActivityPage() {
  const rows = await listAudit({ limit: 200 });
  return (
    <Shell>
      <PageHeader title="Activity" subtitle="Everything changed from this app, newest first." />
      {rows.length === 0 ? (
        <Empty title="Nothing yet">Suspensions, comps, trial extensions and pricing changes are recorded here.</Empty>
      ) : (
        <Card pad={false}>
          <ul className="divide-y divide-line text-sm">
            {rows.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-3">
                <span className="flex min-w-0 flex-wrap items-center gap-2">
                  <Badge tone={TONE[r.action] ?? "brand"}>{actionLabel(r.action)}</Badge>
                  {r.businessId && <Link href={`/tenants/${r.businessId}`} className="font-medium hover:underline">{r.businessName ?? "deleted business"}</Link>}
                  {typeof r.detail.reason === "string" && r.detail.reason && <span className="text-ink-3">“{r.detail.reason}”</span>}
                  {typeof r.detail.days === "number" && <span className="text-ink-3">+{r.detail.days} days</span>}
                </span>
                <span className="text-xs text-ink-3">{r.actor} · {dateTime(r.at)}</span>
                {pricingChanges(r.action, r.detail).length > 0 && <div className="basis-full text-xs text-ink-2">{pricingChanges(r.action, r.detail).join(" · ")}</div>}
              </li>
            ))}
          </ul>
        </Card>
      )}
    </Shell>
  );
}
