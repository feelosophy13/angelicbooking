import Link from "next/link";
import type { Metadata } from "next";
import { Ban, ChevronLeft, ChevronRight, Plus } from "lucide-react";
import { and, asc, desc, eq, gte, inArray, lte } from "drizzle-orm";
import { schema, withTenant } from "@angelic/db";
import { can, instantToISODate, mondayOf } from "@angelic/core";
import { requireAction } from "@/lib/tenant";
import { shiftISODate } from "@/lib/utils";
import { dateLong } from "@/lib/format";
import { describeHours, time12 } from "@/lib/hours";
import { buildCoverage } from "@/server/coverage";
import { listCategories, buildTree, flattenTree } from "@/server/categories";
import { Button, Card, Empty, LinkButton, PageHeader, Select } from "@/components/ui";
import { LocationFilter } from "@/components/location-filter";
import { rowClass, rowControl, RowLink } from "@/components/row";
import { CoverageGaps, CoverageGrid } from "./coverage-grid";

export const metadata: Metadata = { title: "Staff hours" };

type SP = { week?: string; location?: string; scope?: string };
const nextDay = (d: string) => shiftISODate(d, 1);

/**
 * Coverage at a glance: a week with time down the side, who is in on each day as lanes, opening
 * hours as the white area, and a strip that says whether the services in scope are covered.
 * Editing happens on the location page and each person's Weekly hours / Time off.
 */
export default async function StaffHoursPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<SP> }) {
  const { slug } = await params;
  const sp = await searchParams;
  const { business, permissions } = await requireAction(slug, "appointments.read.any");
  const base = `/app/${slug}`;
  const manage = can(permissions, "staff.manage");
  const today = instantToISODate(new Date(), business.timezone);
  const thisMonday = mondayOf(today);
  const weekStart = /^\d{4}-\d{2}-\d{2}$/.test(sp.week ?? "") ? mondayOf(sp.week!) : thisMonday;
  const horizon = shiftISODate(today, 90);

  const { people, overrides, locations, cats, services } = await withTenant(business.id, async (tx) => {
    const people = await tx.select({ id: schema.staff.id, name: schema.staff.displayName }).from(schema.staff).where(and(eq(schema.staff.active, true), eq(schema.staff.takesAppointments, true))).orderBy(asc(schema.staff.sortOrder), asc(schema.staff.displayName));
    const ids = people.map((p) => p.id);
    return {
      people,
      overrides: ids.length
        ? await tx.select().from(schema.staffScheduleOverrides).where(and(inArray(schema.staffScheduleOverrides.staffId, ids), gte(schema.staffScheduleOverrides.date, today), lte(schema.staffScheduleOverrides.date, horizon))).orderBy(asc(schema.staffScheduleOverrides.staffId), asc(schema.staffScheduleOverrides.date))
        : [],
      locations: await tx.select({ id: schema.locations.id, name: schema.locations.name, hours: schema.locations.hours, isDefault: schema.locations.isDefault }).from(schema.locations).orderBy(desc(schema.locations.isDefault), asc(schema.locations.name)),
      cats: await listCategories(business.id, "service"),
      services: await tx.select({ id: schema.services.id, name: schema.services.name, categoryId: schema.services.categoryId }).from(schema.services).where(eq(schema.services.active, true)).orderBy(asc(schema.services.name)),
    };
  });
  const multi = locations.length > 1;
  // One site at a time makes the question answerable; default to the main site when there are several.
  const locationId = multi ? (locations.some((l) => l.id === sp.location) ? sp.location! : sp.location === "" ? null : (locations.find((l) => l.isDefault)?.id ?? locations[0]!.id)) : null;
  const scope = sp.scope ?? "";
  const serviceId = scope.startsWith("s:") && services.some((s) => s.id === scope.slice(2)) ? scope.slice(2) : null;
  const categoryId = scope.startsWith("c:") && cats.some((c) => c.id === scope.slice(2)) ? scope.slice(2) : null;
  const coverage = await buildCoverage(business, { weekStart, locationId, serviceId, categoryId });

  // Query string for links, keeping the other choices. location="" means "all sites" on multi-site tenants.
  const qs = (over: Partial<Record<keyof SP, string | null>>) => {
    const all: Record<keyof SP, string | null> = { week: weekStart === thisMonday ? null : weekStart, location: multi ? (locationId ?? "") : null, scope: scope || null, ...over };
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(all)) if (v !== null && (v !== "" || k === "location")) p.set(k, v);
    return p.toString();
  };
  const shortLoc = (id: string | null) => (id ? (locations.find((l) => l.id === id)?.name ?? "").replace(`${business.name} - `, "") : "");
  const hhmm = (t: string) => t.slice(0, 5);
  const md = (d: string) => new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(d + "T00:00:00Z"));
  const weekLabel = `${md(weekStart)} – ${md(shiftISODate(weekStart, 6))}`;
  const tree = flattenTree(buildTree(cats));
  const hoursHref = (staffId: string) => (manage ? `${base}/staff/${staffId}/hours` : null);

  // Upcoming time off: consecutive identical dates collapse into one range per person.
  type Group = { staffId: string; from: string; to: string; isOff: boolean; startTime: string | null; endTime: string | null; note: string | null };
  const groups: Group[] = [];
  for (const o of overrides) {
    const g = groups[groups.length - 1];
    if (g && g.staffId === o.staffId && nextDay(g.to) === o.date && g.isOff === o.isOff && g.startTime === o.startTime && g.endTime === o.endTime && (g.note ?? "") === (o.note ?? "")) g.to = o.date;
    else groups.push({ staffId: o.staffId, from: o.date, to: o.date, isOff: o.isOff, startTime: o.startTime, endTime: o.endTime, note: o.note });
  }
  groups.sort((a, b) => a.from.localeCompare(b.from));
  const mdw = (d: string) => new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(d + "T00:00:00Z"));
  const range = (g: Group) => (g.from === g.to ? dateLong(g.from) : `${mdw(g.from)} – ${mdw(g.to)}`);
  const nameOf = (id: string) => people.find((p) => p.id === id)?.name ?? "Someone";

  return (
    <>
      <PageHeader title="Staff hours">
        {can(permissions, "appointments.write.any") ? <LinkButton href={`${base}/appointments/block?date=${today}`} size="sm"><Ban className="h-4 w-4" /> Block time</LinkButton> : null}
      </PageHeader>

      <Card className="mb-4 p-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1">
            <LinkButton href={`?${qs({ week: shiftISODate(weekStart, -7) })}`} size="sm"><ChevronLeft className="h-4 w-4" /><span className="sr-only">Previous week</span></LinkButton>
            <LinkButton href={`?${qs({ week: null })}`} size="sm" variant={weekStart === thisMonday ? "ghost" : "secondary"}>This week</LinkButton>
            <LinkButton href={`?${qs({ week: shiftISODate(weekStart, 7) })}`} size="sm"><ChevronRight className="h-4 w-4" /><span className="sr-only">Next week</span></LinkButton>
            <span className="ml-2 text-sm font-medium text-stone-800">{weekLabel}</span>
          </div>
          {multi ? <LocationFilter locations={locations} current={locationId} query={qs({ location: null })} allLabel="All sites" /> : null}
          <form method="get" className="flex items-center gap-2">
            {weekStart !== thisMonday ? <input type="hidden" name="week" value={weekStart} /> : null}
            {multi ? <input type="hidden" name="location" value={locationId ?? ""} /> : null}
            <Select name="scope" defaultValue={scope} aria-label="Services to check coverage for" className="h-9 w-auto max-w-[16rem]">
              <option value="">Coverage for all services</option>
              {tree.map((c) => (
                <optgroup key={c.id} label={`${"– ".repeat(Math.max(0, c.depth))}${c.name}`}>
                  <option value={`c:${c.id}`}>All of {c.name}</option>
                  {services.filter((s) => s.categoryId === c.id).map((s) => <option key={s.id} value={`s:${s.id}`}>{s.name}</option>)}
                </optgroup>
              ))}
              {services.some((s) => !s.categoryId) ? <optgroup label="Other">{services.filter((s) => !s.categoryId).map((s) => <option key={s.id} value={`s:${s.id}`}>{s.name}</option>)}</optgroup> : null}
            </Select>
            <Button type="submit" size="sm" variant="secondary">Check</Button>
          </form>
        </div>
      </Card>

      <Card className="mb-6">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-stone-200 px-4 py-2 text-sm">
          <h2 className="font-semibold text-stone-600">Who covers what{multi ? ` · ${locationId ? shortLoc(locationId) : "all sites"}` : ""}</h2>
          <p className="flex flex-wrap items-center gap-3 text-xs text-stone-500">
            <span><span className="mr-1 inline-block h-2.5 w-1.5 rounded-sm bg-emerald-400 align-middle" />{coverage.scope.label === "All services" ? "every service covered" : `${coverage.scope.label} covered`}</span>
            <span><span className="mr-1 inline-block h-2.5 w-1.5 rounded-sm bg-amber-400 align-middle" />some services uncovered</span>
            <span><span className="mr-1 inline-block h-2.5 w-1.5 rounded-sm bg-red-400 align-middle" />open, nobody in</span>
            <span><span className="hatched mr-1 inline-block h-2.5 w-2.5 rounded-sm border border-stone-200 align-middle" />closed</span>
          </p>
        </div>
        {people.length === 0 ? (
          <div className="p-4"><Empty title="No providers yet" body="Add staff and set their weekly hours." action={manage ? { href: `${base}/staff`, label: "Staff" } : undefined} /></div>
        ) : (
          <CoverageGrid coverage={coverage} today={today} hoursHref={hoursHref} />
        )}
        <div className="border-t border-stone-200">
          <h3 className="px-4 pt-3 text-xs font-semibold uppercase tracking-wide text-stone-500">Needs attention this week</h3>
          <CoverageGaps coverage={coverage} />
        </div>
        <p className="border-t border-stone-100 px-4 py-2 text-xs text-stone-500">
          Rotations, time off and custom hours are already applied. A service nobody is assigned to counts as something everyone can do.
          {manage ? " Click a provider's block to change their hours." : ""}
        </p>
      </Card>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <Card className="min-w-0">
          <div className="flex items-center justify-between gap-3 border-b border-stone-200 px-4 py-2">
            <h2 className="text-sm font-semibold text-stone-600">Time off in the next 90 days</h2>
            {manage ? <LinkButton href={`${base}/staff-hours/time-off`} size="sm"><Plus className="h-4 w-4" /> Add time off</LinkButton> : null}
          </div>
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
