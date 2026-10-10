import Link from "next/link";
import type { Metadata } from "next";
import { Plus } from "lucide-react";
import { can, instantToISODate } from "@angelic/core";
import { requireBusiness } from "@/lib/tenant";
import { listGroupServices, listSessions } from "@/server/classes";
import { formatDateLong, formatTime, shiftISODate } from "@/lib/utils";
import { Card, LinkButton, PageHeader, Empty } from "@/components/ui";

export const metadata: Metadata = { title: "Classes" };

export default async function ClassesPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ past?: string }> }) {
  const { slug } = await params;
  const sp = await searchParams;
  const { business, permissions } = await requireBusiness(slug);
  const tz = business.timezone;
  const past = sp.past === "1";
  const now = new Date();
  const [sessions, groupServices] = await Promise.all([
    listSessions(business.id, past ? { from: new Date(now.getTime() - 90 * 86_400_000), to: now, includeCancelled: true } : { from: new Date(now.getTime() - 3 * 3_600_000), to: new Date(now.getTime() + 120 * 86_400_000), includeCancelled: true }),
    listGroupServices(business.id),
  ]);
  const byDate = new Map<string, typeof sessions>();
  for (const s of past ? [...sessions].reverse() : sessions) {
    const k = instantToISODate(s.startAt, tz);
    byDate.set(k, [...(byDate.get(k) ?? []), s]);
  }
  const write = can(permissions, "appointments.write.any");
  return (
    <>
      <PageHeader title="Classes">
        <LinkButton href={past ? "?" : "?past=1"} size="sm">{past ? "Upcoming" : "Past 90 days"}</LinkButton>
        {write ? <LinkButton href={`/app/${slug}/classes/new`} variant="primary" size="sm"><Plus className="h-4 w-4" /> Schedule a class</LinkButton> : null}
      </PageHeader>
      {groupServices.length === 0 ? (
        <Empty title="No group services yet" body="Give a service a group size above 1 to run it as a class, then schedule sessions here." action={can(permissions, "services.manage") ? { href: `/app/${slug}/services/new`, label: "Add a service" } : undefined} />
      ) : sessions.length === 0 ? (
        <Empty title={past ? "No classes in the last 90 days" : "Nothing scheduled"} body="Schedule a session and clients can book seats online." action={write ? { href: `/app/${slug}/classes/new`, label: "Schedule a class" } : undefined} />
      ) : (
        <div className="space-y-4">
          {[...byDate.entries()].map(([d, list]) => (
            <Card key={d}>
              <h2 className="border-b border-stone-200 px-4 py-2 text-sm font-semibold text-stone-600">{d === instantToISODate(now, tz) ? "Today · " : d === shiftISODate(instantToISODate(now, tz), 1) ? "Tomorrow · " : ""}{formatDateLong(d)}</h2>
              <ul className="divide-y divide-stone-100 text-sm">
                {list.map((s) => (
                  <li key={s.id}>
                    <Link href={`/app/${slug}/classes/${s.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-stone-50">
                      <span className="w-28 shrink-0 text-stone-600">{formatTime(s.startAt, tz)} – {formatTime(s.endAt, tz)}</span>
                      <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: s.staffColor }} />
                      <span className="min-w-0 flex-1">
                        <span className={`block font-medium ${s.status === "cancelled" ? "text-stone-400 line-through" : ""}`}>{s.serviceName}</span>
                        <span className="block text-xs text-stone-500">with {s.staffName}{s.notes ? ` · ${s.notes}` : ""}</span>
                      </span>
                      <span className={`text-xs ${s.seatsLeft === 0 ? "font-medium text-amber-700" : "text-stone-600"}`}>{s.status === "cancelled" ? "Cancelled" : `${s.booked}/${s.capacity} booked`}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}
