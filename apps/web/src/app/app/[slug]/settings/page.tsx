import Link from "next/link";
import type { Metadata } from "next";
import { ChevronRight } from "lucide-react";
import { asc } from "drizzle-orm";
import { schema, withTenant } from "@angelic/db";
import { can } from "@angelic/core";
import { planMonthlyCents } from "@/server/billing";
import { requireAnyAction } from "@/lib/tenant";
import { Card, PageHeader } from "@/components/ui";
import { SETTINGS_ACTIONS, settingsGroups } from "@/lib/nav";
import { aiConfigured } from "@/server/ai";

export const metadata: Metadata = { title: "Settings" };

/** A short, grouped directory of the pages this person may open. Each page explains itself; this one just helps you find it. */
export default async function SettingsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { business, permissions } = await requireAnyAction(slug, ...SETTINGS_ACTIONS);
  const [locations, monthly] = await Promise.all([
    withTenant(business.id, (tx) => tx.select({ id: schema.locations.id }).from(schema.locations).orderBy(asc(schema.locations.name))),
    can(permissions, "billing.manage") || can(permissions, "settings.business") ? planMonthlyCents(business) : null,
  ]);
  const groups = settingsGroups(`/app/${slug}`, permissions, { ...business, locationCount: locations.length, planMonthlyCents: monthly, aiAvailable: aiConfigured() });
  return (
    <>
      <PageHeader title="Settings" />
      <div className="grid gap-6 lg:grid-cols-2">
        {groups.map((g) => (
          <section key={g.title}>
            <h2 className="mb-2 px-1 text-xs font-semibold uppercase tracking-wide text-stone-500">{g.title}</h2>
            <Card>
              <ul className="divide-y divide-stone-100">
                {g.entries.map((e) => (
                  <li key={e.href}>
                    {e.readOnly ? (
                      <div className="flex items-center gap-3 px-4 py-3">
                        <span className="min-w-0 flex-1">
                          <span className="block text-sm font-medium text-stone-900">{e.title}</span>
                          <span className="block truncate text-xs text-stone-500">{e.blurb}</span>
                        </span>
                        {e.status ? <span className="shrink-0 rounded-full bg-stone-100 px-2 py-0.5 text-xs text-stone-600">{e.status}</span> : null}
                      </div>
                    ) : (
                      <Link href={e.href} className="flex items-center gap-3 px-4 py-3 hover:bg-stone-50">
                        <span className="min-w-0 flex-1">
                          <span className="block text-sm font-medium text-stone-900">{e.title}</span>
                          <span className="block truncate text-xs text-stone-500">{e.blurb}</span>
                        </span>
                        {e.status ? <span className="shrink-0 rounded-full bg-stone-100 px-2 py-0.5 text-xs text-stone-600">{e.status}</span> : null}
                        <ChevronRight className="h-4 w-4 shrink-0 text-stone-300" aria-hidden />
                      </Link>
                    )}
                  </li>
                ))}
              </ul>
            </Card>
          </section>
        ))}
      </div>
    </>
  );
}
