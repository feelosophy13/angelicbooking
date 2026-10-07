import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Activity log" };
import { desc, eq, inArray } from "drizzle-orm";
import { db, schema, withTenant } from "@angelic/db";
import { requireAction } from "@/lib/tenant";
import { BackLink, Card, PageHeader, Empty } from "@/components/ui";

export default async function AuditPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ page?: string }> }) {
  const { slug } = await params;
  const page = Math.max(1, Number((await searchParams).page) || 1);
  const PAGE = 100;
  const { business } = await requireAction(slug, "business.manage");
  const rows = await withTenant(business.id, (tx) =>
    tx.select().from(schema.auditLog).orderBy(desc(schema.auditLog.at)).limit(PAGE + 1).offset((page - 1) * PAGE),
  );
  const userIds = [...new Set(rows.map((r) => r.actorUserId).filter((x): x is string => !!x))];
  const users = userIds.length
    ? await db.select({ id: schema.user.id, name: schema.user.name }).from(schema.user).where(inArray(schema.user.id, userIds))
    : [];
  const nameById = new Map(users.map((u) => [u.id, u.name]));
  const fmt = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: business.timezone });

  return (
    <>
      <div className="mb-2"><BackLink href={`/app/${slug}/settings`}>Settings</BackLink></div>
      <PageHeader title="Activity log" />
      {rows.length === 0 ? (
        <Empty title="Nothing yet" body="Bookings, reschedules and status changes will show up here." />
      ) : (
        <Card>
          <div className="overflow-x-auto"><table className="w-full text-sm">
            <thead className="text-left text-xs uppercase tracking-wide text-stone-500">
              <tr>
                <th className="px-4 py-2">When</th>
                <th className="px-4 py-2">Who</th>
                <th className="px-4 py-2">Action</th>
                <th className="px-4 py-2">Record</th>
                <th className="px-4 py-2">Details</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-200">
              {rows.slice(0, PAGE).map((r) => (
                <tr key={r.id} className="align-top">
                  <td className="whitespace-nowrap px-4 py-2 text-stone-600">{fmt.format(r.at)}</td>
                  <td className="whitespace-nowrap px-4 py-2">{r.actorUserId ? (nameById.get(r.actorUserId) ?? "unknown") : "system"}</td>
                  <td className="whitespace-nowrap px-4 py-2 font-medium">{r.action.replace(/[._]/g, " ")}</td>
                  <td className="whitespace-nowrap px-4 py-2">
                    {r.entity === "appointment" && r.entityId ? (
                      <Link href={`/app/${slug}/appointments/${r.entityId}`} className="text-brand-700 underline">appointment</Link>
                    ) : (
                      r.entity
                    )}
                  </td>
                  <td className="max-w-md truncate px-4 py-2 font-mono text-xs text-stone-500">{r.diff ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </table></div>
          <div className="flex items-center justify-between border-t border-stone-200 px-4 py-2 text-sm">
            {page > 1 ? <Link href={`?page=${page - 1}`} className="text-brand-700 underline">Newer</Link> : <span />}
            {rows.length > PAGE ? <Link href={`?page=${page + 1}`} className="text-brand-700 underline">Older</Link> : <span />}
          </div>
        </Card>
      )}
    </>
  );
}
