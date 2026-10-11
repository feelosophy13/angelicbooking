import Link from "next/link";
import type { Metadata } from "next";
import { Ban } from "lucide-react";
import { and, asc, desc, eq, gte, inArray, lte } from "drizzle-orm";
import { schema, withTenant } from "@angelic/db";
import { can, instantToISODate, mondayOf, rotationWeekIndex } from "@angelic/core";
import { requireAction } from "@/lib/tenant";
import { shiftISODate } from "@/lib/utils";
import { dateLong, initials } from "@/lib/format";
import { describeHours, time12 } from "@/lib/hours";
import { Card, Empty, LinkButton, PageHeader } from "@/components/ui";
import { LinkRow } from "@/components/table-row";
import { rowClass, rowControl, RowLink } from "@/components/row";

export const metadata: Metadata = { title: "Staff hours" };

const DAYS = [1, 2, 3, 4, 5, 6, 0]; // Monday first
const DAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const nextDay = (d: string) => shiftISODate(d, 1);

/**
 * The schedule side of staff: opening hours, who works when (with rotations and sites), and upcoming
 * time off, all on one page. Editing happens on the location page and each person's Weekly hours / Time off.
 */
export default async function StaffHoursPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { business, permissions } = await requireAction(slug, "appointments.read.any");
  const base = `/app/${slug}`;
  const manage = can(permissions, "staff.manage");
  const today = instantToISODate(new Date(), business.timezone);
  const horizon = shiftISODate(today, 90);
  const { people, rows, overrides, locations } = await withTenant(business.id, async (tx) => {
    const people = await tx
      .select({ id: schema.staff.id, name: schema.staff.displayName, color: schema.staff.color, photoUrl: schema.staff.photoUrl, locationId: schema.staff.locationId, rotationWeeks: schema.staff.rotationWeeks, rotationAnchor: schema.staff.rotationAnchor })
      .from(schema.staff)
      .where(and(eq(schema.staff.active, true), eq(schema.staff.takesAppointments, true)))
      .orderBy(asc(schema.staff.sortOrder), asc(schema.staff.displayName));
    const ids = people.map((p) => p.id);
    return {
      people,
      rows: ids.length ? await tx.select().from(schema.staffSchedules).where(inArray(schema.staffSchedules.staffId, ids)).orderBy(asc(schema.staffSchedules.weekIndex), asc(schema.staffSchedules.weekday), asc(schema.staffSchedules.startTime)) : [],
      overrides: ids.length
        ? await tx.select().from(schema.staffScheduleOverrides).where(and(inArray(schema.staffScheduleOverrides.staffId, ids), gte(schema.staffScheduleOverrides.date, today), lte(schema.staffScheduleOverrides.date, horizon))).orderBy(asc(schema.staffScheduleOverrides.staffId), asc(schema.staffScheduleOverrides.date))
        : [],
      locations: await tx.select({ id: schema.locations.id, name: schema.locations.name, hours: schema.locations.hours, isDefault: schema.locations.isDefault }).from(schema.locations).orderBy(desc(schema.locations.isDefault), asc(schema.locations.name)),
    };
  });
  const multi = locations.length > 1;
  const defaultLoc = locations.find((l) => l.isDefault)?.id ?? locations[0]?.id ?? null;
  const shortLoc = (id: string | null) => (id ? (locations.find((l) => l.id === id)?.name ?? "").replace(`${business.name} - `, "") : "");
  const hhmm = (t: string) => t.slice(0, 5);
  const span = (r: { startTime: string; endTime: string }) => `${time12(hhmm(r.startTime))}–${time12(hhmm(r.endTime))}`;

  // One cell per person and weekday; a rotation shows one line per week with the live week first-marked.
  const cell = (p: (typeof people)[number], weekday: number) => {
    const mine = rows.filter((r) => r.staffId === p.id && r.weekday === weekday);
    const weeks = Math.max(1, p.rotationWeeks);
    const nowWeek = rotationWeekIndex(today, { weeks, anchor: p.rotationAnchor ?? mondayOf(today) });
    return Array.from({ length: weeks }, (_, w) => {
      const blocks = mine.filter((r) => r.weekIndex === w);
      const loc = blocks[0]?.locationId ?? p.locationId ?? defaultLoc;
      return { w, text: blocks.length ? blocks.map(span).join(", ") : null, loc: multi && blocks.length ? shortLoc(loc) : null, now: weeks > 1 && w === nowWeek };
    });
  };

  // Upcoming time off: consecutive identical dates collapse into one range per person.
  type Group = { staffId: string; from: string; to: string; isOff: boolean; startTime: string | null; endTime: string | null; note: string | null };
  const groups: Group[] = [];
  for (const o of overrides) {
    const g = groups[groups.length - 1];
    if (g && g.staffId === o.staffId && nextDay(g.to) === o.date && g.isOff === o.isOff && g.startTime === o.startTime && g.endTime === o.endTime && (g.note ?? "") === (o.note ?? "")) g.to = o.date;
    else groups.push({ staffId: o.staffId, from: o.date, to: o.date, isOff: o.isOff, startTime: o.startTime, endTime: o.endTime, note: o.note });
  }
  groups.sort((a, b) => a.from.localeCompare(b.from));
  const md = (d: string) => new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(d + "T00:00:00Z"));
  const range = (g: Group) => (g.from === g.to ? dateLong(g.from) : `${md(g.from)} – ${md(g.to)}`);
  const nameOf = (id: string) => people.find((p) => p.id === id)?.name ?? "Someone";

  return (
    <>
      <PageHeader title="Staff hours">
        {can(permissions, "appointments.write.any") ? <LinkButton href={`${base}/appointments/block?date=${today}`} size="sm"><Ban className="h-4 w-4" /> Block time</LinkButton> : null}
      </PageHeader>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="min-w-0 space-y-6">
          <Card>
            <h2 className="border-b border-stone-200 px-4 py-2 text-sm font-semibold text-stone-600">Who works when</h2>
            {people.length === 0 ? (
              <div className="p-4"><Empty title="No providers yet" body="Add staff and set their weekly hours." action={manage ? { href: `${base}/staff`, label: "Staff" } : undefined} /></div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs uppercase tracking-wide text-stone-500">
                      <th className="sticky left-0 bg-white px-4 py-2 font-semibold">Provider</th>
                      {DAYS.map((d) => <th key={d} className="px-3 py-2 font-semibold">{DAY_SHORT[d]}</th>)}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-stone-100">
                    {people.map((p) => {
                      const cells = DAYS.map((d) => cell(p, d));
                      const weeks = Math.max(1, p.rotationWeeks);
                      const inner = (
                        <>
                          <td className="sticky left-0 whitespace-nowrap bg-white px-4 py-2 align-top">
                            <div className="flex items-center gap-2.5">
                              {p.photoUrl ? <img src={p.photoUrl} alt="" className="h-7 w-7 rounded-full object-cover" /> : <span className="flex h-7 w-7 items-center justify-center rounded-full text-[11px] font-semibold text-white" style={{ background: p.color }}>{initials(p.name)}</span>}
                              <div className="min-w-0">
                                {manage ? <RowLink href={`${base}/staff/${p.id}/hours`} className="font-medium">{p.name}</RowLink> : <span className="font-medium">{p.name}</span>}
                                {weeks > 1 ? <p className="text-xs text-stone-500">{weeks}-week rotation</p> : null}
                              </div>
                            </div>
                          </td>
                          {cells.map((c, i) => (
                            <td key={i} className="whitespace-nowrap px-3 py-2 align-top tabular-nums">
                              {c.map((line) => (
                                <p key={line.w} className={line.text ? "text-stone-800" : "text-stone-300"}>
                                  {weeks > 1 ? <span className={`mr-1 text-[11px] ${line.now ? "font-semibold text-brand-700" : "text-stone-400"}`}>W{line.w + 1}</span> : null}
                                  {line.text ?? "—"}
                                  {line.loc ? <span className="ml-1 text-xs text-stone-500">{line.loc}</span> : null}
                                </p>
                              ))}
                            </td>
                          ))}
                        </>
                      );
                      return manage ? (
                        <LinkRow key={p.id} href={`${base}/staff/${p.id}/hours`} className={`${rowClass} cursor-pointer`}>{inner}</LinkRow>
                      ) : (
                        <tr key={p.id}>{inner}</tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
            <p className="border-t border-stone-100 px-4 py-2 text-xs text-stone-500">{manage ? "Click a provider to change their hours, breaks, rotation or sites." : "Hours are set under Staff by a manager."}{multi ? " Site shown next to each day." : ""}</p>
          </Card>

          <Card>
            <h2 className="border-b border-stone-200 px-4 py-2 text-sm font-semibold text-stone-600">Time off in the next 90 days</h2>
            {groups.length === 0 ? (
              <div className="p-4"><Empty title="Nothing scheduled" body="Days off and custom hours added under a provider's Time off show here." /></div>
            ) : (
              <ul className="divide-y divide-stone-100 text-sm">
                {groups.map((g) => {
                  const days = Math.round((Date.parse(g.to) - Date.parse(g.from)) / 86_400_000) + 1;
                  const what = g.isOff ? (days > 1 ? `${days} days off` : "Day off") : `${time12(hhmm(g.startTime!))}–${time12(hhmm(g.endTime!))}${days > 1 ? ` · ${days} days` : ""}`;
                  return (
                    <li key={`${g.staffId}:${g.from}`} className={`${rowClass} flex items-center gap-3 px-4 py-2`}>
                      <div className="min-w-0 flex-1">
                        <p className="font-medium">{manage ? <RowLink href={`${base}/staff/${g.staffId}/time-off`}>{nameOf(g.staffId)}</RowLink> : nameOf(g.staffId)} <span className="font-normal text-stone-500">· {range(g)}</span></p>
                        <p className="text-xs text-stone-500">{what}{g.note ? ` · ${g.note}` : ""}</p>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>
        </div>

        <Card className="min-w-0">
          <h2 className="border-b border-stone-200 px-4 py-2 text-sm font-semibold text-stone-600">Business hours</h2>
          <ul className="divide-y divide-stone-100 text-sm">
            {locations.map((l) => (
              <li key={l.id} className={`${rowClass} px-4 py-3`}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    {multi ? <p className="font-medium">{can(permissions, "business.manage") ? <RowLink href={`${base}/settings/locations/${l.id}`}>{shortLoc(l.id)}</RowLink> : shortLoc(l.id)}</p> : null}
                    {l.hours ? (
                      <div className={`grid grid-cols-[2.5rem_auto] gap-x-2 text-xs leading-5 ${multi ? "mt-1 text-stone-600" : "text-stone-700"}`}>
                        {describeHours(l.hours).map((line) => {
                          const [day, ...rest] = line.split(" ");
                          return [<span key={`${day}d`} className="text-stone-500">{day}</span>, <span key={`${day}h`}>{rest.join(" ")}</span>];
                        })}
                      </div>
                    ) : (
                      <p className="text-xs text-stone-500">No opening hours set</p>
                    )}
                  </div>
                  {can(permissions, "business.manage") ? <Link href={`${base}/settings/locations/${l.id}`} className={`${rowControl} text-sm text-brand-700 hover:underline`}>Edit</Link> : null}
                </div>
              </li>
            ))}
          </ul>
          <p className="border-t border-stone-100 px-4 py-2 text-xs text-stone-500">Online booking only offers times inside these hours.</p>
        </Card>
      </div>
    </>
  );
}
