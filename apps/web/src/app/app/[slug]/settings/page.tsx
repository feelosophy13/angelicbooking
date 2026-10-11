import Link from "next/link";
import type { Metadata } from "next";
import { ChevronRight } from "lucide-react";
import { asc } from "drizzle-orm";
import { schema, withTenant } from "@angelic/db";
import { requireAction } from "@/lib/tenant";
import { Card, PageHeader } from "@/components/ui";
import { settingsGroups } from "@/lib/nav";

export const metadata: Metadata = { title: "Settings" };

/** A short, grouped directory. Each page explains itself; this one just helps you find it. */
export default async function SettingsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { business } = await requireAction(slug, "business.manage");
  const locations = await withTenant(business.id, (tx) => tx.select({ id: schema.locations.id }).from(schema.locations).orderBy(asc(schema.locations.name)));
  const groups = settingsGroups(`/app/${slug}`, { ...business, locationCount: locations.length });
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
                    <Link href={e.href} className="flex items-center gap-3 px-4 py-3 hover:bg-stone-50">
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-medium text-stone-900">{e.title}</span>
                        <span className="block truncate text-xs text-stone-500">{e.blurb}</span>
                      </span>
                      {e.status ? <span className="shrink-0 rounded-full bg-stone-100 px-2 py-0.5 text-xs text-stone-600">{e.status}</span> : null}
                      <ChevronRight className="h-4 w-4 shrink-0 text-stone-300" aria-hidden />
                    </Link>
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
