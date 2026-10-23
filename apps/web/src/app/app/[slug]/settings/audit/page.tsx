import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Activity log" };
import { and, desc, eq, inArray, like, sql } from "drizzle-orm";
import { db, schema, withTenant } from "@angelic/db";
import { requireAction } from "@/lib/tenant";
import { BackLink, Button, Card, PageHeader, Empty, Select } from "@/components/ui";
import { StackTable } from "@/components/stack-table";

export default async function AuditPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ page?: string; area?: string; who?: string }> }) {
  const { slug } = await params;
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page) || 1);
  const PAGE = 100;
  const { business } = await requireAction(slug, "audit.view");
  // Filters: the area is what comes before the first dot of an action ("settings", "payroll", "staff"…); who is a person or "system".
  const area = sp.area && /^[a-z_]+$/.test(sp.area) ? sp.area : null;
  const who = sp.who || null;
  const [rows, areas, people] = await withTenant(business.id, async (tx) => [
    await tx
      .select()
      .from(schema.auditLog)
      .where(and(area ? like(schema.auditLog.action, `${area}.%`) : undefined, who === "system" ? sql`${schema.auditLog.actorUserId} is null` : who ? eq(schema.auditLog.actorUserId, who) : undefined))
      .orderBy(desc(schema.auditLog.at))
      .limit(PAGE + 1)
      .offset((page - 1) * PAGE),
    (await tx.selectDistinct({ a: sql<string>`split_part(${schema.auditLog.action}, '.', 1)` }).from(schema.auditLog)).map((r) => r.a).sort(),
    (await tx.selectDistinct({ id: schema.auditLog.actorUserId }).from(schema.auditLog)).map((r) => r.id).filter((x): x is string => !!x && x !== "client"),
  ] as const);
  const keep = (extra: string) => [area ? `area=${area}` : "", who ? `who=${encodeURIComponent(who)}` : "", extra].filter(Boolean).join("&");
  const userIds = [...new Set([...rows.map((r) => r.actorUserId), ...people].filter((x): x is string => !!x))];
  const users = userIds.length
    ? await db.select({ id: schema.user.id, name: schema.user.name }).from(schema.user).where(inArray(schema.user.id, userIds))
    : [];
  const nameById = new Map(users.map((u) => [u.id, u.name]));
  const fmt = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: business.timezone });

  return (
    <>
      <div className="mb-2"><BackLink href={`/app/${slug}/settings`}>Settings</BackLink></div>
      <PageHeader title="Activity log">
        <form className="flex flex-wrap items-center gap-2">
          <Select name="area" defaultValue={area ?? ""} aria-label="Area" className="w-40">
            <option value="">Everything</option>
            {areas.map((a) => <option key={a} value={a}>{a.replace(/_/g, " ")}</option>)}
          </Select>
          <Select name="who" defaultValue={who ?? ""} aria-label="Who" className="w-44">
            <option value="">Anyone</option>
            {people.map((id) => <option key={id} value={id}>{nameById.get(id) ?? "former member"}</option>)}
            <option value="system">System</option>
          </Select>
          <Button type="submit" variant="secondary" size="sm">Filter</Button>
        </form>
      </PageHeader>
      {rows.length === 0 ? (
        <Empty title="Nothing yet" body="Bookings, reschedules and status changes will show up here." />
      ) : (
        <Card>
          <div className="overflow-x-auto"><StackTable className="w-full text-sm">
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
                  <td className="whitespace-nowrap px-4 py-2">{r.actorUserId === "client" ? "the client" : r.actorUserId ? (nameById.get(r.actorUserId) ?? "former member") : "system"}</td>
                  <td className="whitespace-nowrap px-4 py-2 font-medium">{r.action.replace(/[._]/g, " ")}</td>
                  <td className="whitespace-nowrap px-4 py-2">
                    {r.entity === "appointment" && r.entityId ? (
                      <Link href={`/app/${slug}/appointments/${r.entityId}`} className="text-brand-700 underline">appointment</Link>
                    ) : r.entity === "chart" && r.entityId ? (
                      <Link href={`/app/${slug}/charts/${r.entityId}`} className="text-brand-700 underline">chart</Link>
                    ) : (
                      r.entity
                    )}
                  </td>
                  <td className="max-w-md truncate px-4 py-2 font-mono text-xs text-stone-500">{r.diff ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </StackTable></div>
          <div className="flex items-center justify-between border-t border-stone-200 px-4 py-2 text-sm">
            {page > 1 ? <Link href={`?${keep(`page=${page - 1}`)}`} className="text-brand-700 underline">Newer</Link> : <span />}
            {rows.length > PAGE ? <Link href={`?${keep(`page=${page + 1}`)}`} className="text-brand-700 underline">Older</Link> : <span />}
          </div>
        </Card>
      )}
    </>
  );
}
