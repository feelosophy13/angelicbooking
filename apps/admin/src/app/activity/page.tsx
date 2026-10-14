import type { Metadata } from "next";
import Link from "next/link";
import { Shell, dateTime } from "@/components";
import { actionLabel, listAudit } from "@/lib/audit";

export const metadata: Metadata = { title: "Activity" };
export const dynamic = "force-dynamic";

export default async function ActivityPage() {
  const rows = await listAudit({ limit: 200 });
  return (
    <Shell>
      <h1 className="text-xl font-semibold">Activity</h1>
      <p className="mt-1 text-sm text-stone-600">Everything changed from this app, newest first.</p>
      <ul className="mt-4 divide-y divide-stone-100 rounded-lg border border-stone-200 bg-white text-sm">
        {rows.map((r) => (
          <li key={r.id} className="flex flex-wrap justify-between gap-x-4 px-3 py-2">
            <span>
              <span className="font-medium">{actionLabel(r.action)}</span>
              {r.businessId && <> · <Link href={`/tenants/${r.businessId}`} className="underline">{r.businessName ?? "deleted business"}</Link></>}
              {typeof r.detail.reason === "string" && r.detail.reason && <span className="text-stone-500"> · “{r.detail.reason}”</span>}
              {typeof r.detail.days === "number" && <span className="text-stone-500"> · +{r.detail.days} days</span>}
            </span>
            <span className="text-stone-500">{r.actor} · {dateTime(r.at)}</span>
          </li>
        ))}
        {rows.length === 0 && <li className="px-3 py-6 text-center text-stone-500">Nothing yet.</li>}
      </ul>
    </Shell>
  );
}
