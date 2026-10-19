import Link from "next/link";
import type { Metadata } from "next";
import { Ban, ChevronDown, ChevronLeft, ChevronRight, Pencil, Plus } from "lucide-react";
import { and, asc, desc, eq, gte, inArray, lte } from "drizzle-orm";
import { schema, withTenant } from "@angelic/db";
import { can, instantToISODate, mondayOf } from "@angelic/core";
import { requireAction } from "@/lib/tenant";
import { cn, shiftISODate } from "@/lib/utils";
import { dateLong } from "@/lib/format";
import { describeHours, time12 } from "@/lib/hours";
import { matchesPeople, monthDates, monthLabel, monthOf, orderStaff, parsePeopleFilter, peopleOptions, shiftMonth } from "@/lib/staff-hours";
import { buildCoverage } from "@/server/coverage";
import { listCategories, buildTree, flattenTree } from "@/server/categories";
import { Card, Empty, LinkButton, PageHeader, Select } from "@/components/ui";
import { AutoSubmitForm } from "@/components/auto-submit-form";
import { LocationFilter } from "@/components/location-filter";
import { rowClass, rowControl, RowLink } from "@/components/row";
import { CoverageGaps, CoverageGrid, type CoverageMode } from "./coverage-grid";
import { MonthGrid } from "./month-grid";

export const metadata: Metadata = { title: "Staff hours" };

type SP = { week?: string; location?: string; scope?: string; view?: string; people?: string; period?: string; month?: string };
const nextDay = (d: string) => shiftISODate(d, 1);

/**
 * Coverage at a glance: a week with time down the side, who is in on each day as lanes, opening
 * hours as the white area, and a strip that says whether the services in scope are covered.
 * The Month view is the same schedule as a roster: a cell per day with each person's hours.
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
  // Week (default) or Month. The month view keeps its own anchor (`?month=YYYY-MM`) so the week comes back where it was.
  const period: "week" | "month" = sp.period === "month" ? "month" : "week";
  const thisMonth = monthOf(today);
  const month = /^\d{4}-\d{2}$/.test(sp.month ?? "") ? sp.month! : thisMonth;
  const horizon = shiftISODate(today, 90);

  const { people, peopleFilter, shown, overrides, locations, cats } = await withTenant(business.id, async (tx) => {
    // Everyone who is active: front desk and managers keep weekly hours and time off too, not only providers.
    const people = orderStaff(await tx.select({ id: schema.staff.id, name: schema.staff.displayName, takesAppointments: schema.staff.takesAppointments, sortOrder: schema.staff.sortOrder, position: schema.staff.position }).from(schema.staff).where(eq(schema.staff.active, true)).orderBy(asc(schema.staff.sortOrder), asc(schema.staff.displayName)));
    // The People filter: everyone (default), providers, front desk and other staff, or one position. It drives the lanes,
    // the Edit hours menu and the time-off list; the coverage strip still judges every provider.
    const peopleFilter = parsePeopleFilter(sp.people, people);
    const shown = people.filter((p) => matchesPeople(p, peopleFilter));
    const ids = shown.map((p) => p.id);
    return {
      people,
      peopleFilter,
      shown,
      overrides: ids.length
        ? await tx.select().from(schema.staffScheduleOverrides).where(and(inArray(schema.staffScheduleOverrides.staffId, ids), gte(schema.staffScheduleOverrides.date, today), lte(schema.staffScheduleOverrides.date, horizon))).orderBy(asc(schema.staffScheduleOverrides.staffId), asc(schema.staffScheduleOverrides.date))
        : [],
      locations: await tx.select({ id: schema.locations.id, name: schema.locations.name, hours: schema.locations.hours, isDefault: schema.locations.isDefault }).from(schema.locations).orderBy(desc(schema.locations.isDefault), asc(schema.locations.name)),
      cats: await listCategories(business.id, "service"),
    };
  });
  const multi = locations.length > 1;
  // Hours differ by site, so coverage is always for one site: the one chosen, else the main site.
  const locationId = multi ? (locations.some((l) => l.id === sp.location) ? sp.location! : (locations.find((l) => l.isDefault)?.id ?? locations[0]!.id)) : null;
  // "people" (default) draws each person; "coverage" shows only whether the categories are covered.
  const view: CoverageMode = sp.view === "coverage" ? "coverage" : "people";
  const scope = sp.scope ?? "";
  // Coverage is shown per service category (a service picker was too long to be useful).
  const categoryId = scope.startsWith("c:") && cats.some((c) => c.id === scope.slice(2)) ? scope.slice(2) : null;
  const coverage = await buildCoverage(business, { ...(period === "month" ? { dates: monthDates(month) } : { weekStart }), locationId, categoryId, laneStaffIds: shown.map((p) => p.id) });

  // Query string for links, keeping the other choices.
  const qs = (over: Partial<Record<keyof SP, string | null>>) => {
    const all: Record<keyof SP, string | null> = {
      period: period === "month" ? "month" : null,
      week: period === "week" && weekStart !== thisMonday ? weekStart : null,
      month: period === "month" && month !== thisMonth ? month : null,
      location: locationId,
      scope: categoryId ? `c:${categoryId}` : null,
      view: view === "coverage" ? "coverage" : null,
      people: peopleFilter || null,
      ...over,
    };
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(all)) if (v) p.set(k, v);
    return p.toString();
  };
  const shortLoc = (id: string | null) => (id ? (locations.find((l) => l.id === id)?.name ?? "").replace(`${business.name} - `, "") : "");
  const hhmm = (t: string) => t.slice(0, 5);
  const md = (d: string) => new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(d + "T00:00:00Z"));
  const weekLabel = `${md(weekStart)} – ${md(shiftISODate(weekStart, 6))}`;
  // Switching period lands on the same stretch of time: the week's month, or the month's first week (this week when it is this month).
  const periodHref = (to: "week" | "month") => (to === "month" ? qs({ period: "month", month: monthOf(weekStart) === thisMonth ? null : monthOf(weekStart), week: null }) : qs({ period: null, month: null, week: month === thisMonth ? null : mondayOf(`${month}-01`) }));
  const weekHref = (date: string) => `?${qs({ period: null, month: null, week: mondayOf(date) === thisMonday ? null : mondayOf(date) })}`;
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
  const peopleChoices = peopleOptions(people);
  const peopleLabel = peopleChoices.find((o) => o.value === peopleFilter)?.label ?? "Everyone";

  return (
    <>
      <PageHeader title="Staff hours">
        {manage && shown.length ? (
          <details className="group relative">
            <summary className="inline-flex h-9 cursor-pointer select-none items-center gap-1.5 rounded-lg border border-stone-300 bg-white px-3 text-sm font-medium text-stone-800 hover:bg-stone-50 marker:content-none [&::-webkit-details-marker]:hidden">
              <Pencil className="h-4 w-4" /> Edit hours <ChevronDown className="h-4 w-4 text-stone-400 transition-transform group-open:rotate-180" aria-hidden />
            </summary>
            <ul className="absolute right-0 z-20 mt-1 w-56 rounded-lg border border-stone-200 bg-white py-1 text-sm shadow-lg">
              {shown.map((p) => (
                <li key={p.id}><Link href={`${base}/staff/${p.id}/hours`} className="block px-3 py-1.5 text-stone-800 hover:bg-stone-50">{p.name}</Link></li>
              ))}
            </ul>
          </details>
        ) : null}
        {can(permissions, "appointments.write.any") ? <LinkButton href={`${base}/appointments/block?date=${today}`} size="sm"><Ban className="h-4 w-4" /> Block time</LinkButton> : null}
      </PageHeader>

      <Card className="mb-4 p-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex h-8 rounded-lg border border-stone-300 bg-white p-0.5 text-sm" role="group" aria-label="Week or month">
            {(["week", "month"] as const).map((key) => (
              <Link key={key} href={`?${periodHref(key)}`} aria-current={period === key ? "true" : undefined} className={cn("inline-flex items-center rounded-md px-3", period === key ? "bg-stone-900 text-white" : "text-stone-700 hover:bg-stone-50")}>{key === "week" ? "Week" : "Month"}</Link>
            ))}
          </div>
          {period === "month" ? (
            <div className="flex items-center gap-1">
              <LinkButton href={`?${qs({ month: shiftMonth(month, -1) })}`} size="sm"><ChevronLeft className="h-4 w-4" /><span className="sr-only">Previous month</span></LinkButton>
              <LinkButton href={`?${qs({ month: null })}`} size="sm" variant={month === thisMonth ? "ghost" : "secondary"}>This month</LinkButton>
              <LinkButton href={`?${qs({ month: shiftMonth(month, 1) })}`} size="sm"><ChevronRight className="h-4 w-4" /><span className="sr-only">Next month</span></LinkButton>
              <span className="ml-2 text-sm font-medium text-stone-800">{monthLabel(month)}</span>
            </div>
          ) : (
            <div className="flex items-center gap-1">
              <LinkButton href={`?${qs({ week: shiftISODate(weekStart, -7) })}`} size="sm"><ChevronLeft className="h-4 w-4" /><span className="sr-only">Previous week</span></LinkButton>
              <LinkButton href={`?${qs({ week: null })}`} size="sm" variant={weekStart === thisMonday ? "ghost" : "secondary"}>This week</LinkButton>
              <LinkButton href={`?${qs({ week: shiftISODate(weekStart, 7) })}`} size="sm"><ChevronRight className="h-4 w-4" /><span className="sr-only">Next week</span></LinkButton>
              <span className="ml-2 text-sm font-medium text-stone-800">{weekLabel}</span>
            </div>
          )}
          {multi ? <LocationFilter locations={locations} current={locationId} query={qs({ location: null })} allLabel={null} /> : null}
          <AutoSubmitForm className="flex flex-wrap items-center gap-2">
            {period === "month" ? <input type="hidden" name="period" value="month" /> : null}
            {period === "month" && month !== thisMonth ? <input type="hidden" name="month" value={month} /> : null}
            {period === "week" && weekStart !== thisMonday ? <input type="hidden" name="week" value={weekStart} /> : null}
            {multi ? <input type="hidden" name="location" value={locationId ?? ""} /> : null}
            {view === "coverage" ? <input type="hidden" name="view" value="coverage" /> : null}
            <Select name="scope" defaultValue={categoryId ? `c:${categoryId}` : ""} aria-label="Service category to check coverage for" className="h-9 w-auto max-w-[16rem]">
              <option value="">All services</option>
              {tree.map((c) => <option key={c.id} value={`c:${c.id}`}>{"\u00a0\u00a0".repeat(Math.max(0, c.depth))}{c.name}</option>)}
            </Select>
            <Select name="people" defaultValue={peopleFilter} aria-label="Who to show" className="h-9 w-auto max-w-[14rem]">
              {peopleChoices.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </Select>
          </AutoSubmitForm>
        </div>
      </Card>

      <Card className="mb-6">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-stone-200 px-4 py-2 text-sm">
          <h2 className="font-semibold text-stone-600">{period === "month" ? "Who is in each day" : "Who covers what"}{multi ? ` · ${shortLoc(locationId)}` : ""}</h2>
          {period === "week" ? (
            <div className="flex rounded-lg border border-stone-300 bg-white p-0.5 text-sm" role="group" aria-label="What to show">
              {([["people", "People"], ["coverage", "Coverage"]] as const).map(([key, label]) => (
                <Link key={key} href={`?${qs({ view: key === "coverage" ? "coverage" : null })}`} aria-current={view === key ? "true" : undefined} className={cn("rounded-md px-3 py-0.5", view === key ? "bg-stone-900 text-white" : "text-stone-700 hover:bg-stone-50")}>{label}</Link>
              ))}
            </div>
          ) : null}
          <p className="flex flex-wrap items-center gap-3 text-xs text-stone-500">
            {period === "week" && view === "coverage" ? <span><span className="mr-1 inline-block h-2.5 w-1.5 rounded-sm bg-emerald-400 align-middle" />{coverage.scope.label === "All services" ? "every service covered" : `${coverage.scope.label} covered`}</span> : null}
            {period === "week" && view === "coverage" ? <span><span className="mr-1 inline-block h-2.5 w-1.5 rounded-sm bg-amber-400 align-middle" />some services uncovered</span> : null}
            {period === "week" ? <span><span className="mr-1 inline-block h-2.5 w-1.5 rounded-sm bg-red-400 align-middle" />open, no provider in</span> : null}
            <span><span className="hatched mr-1 inline-block h-2.5 w-2.5 rounded-sm border border-stone-200 align-middle" />closed</span>
          </p>
        </div>
        {people.length === 0 ? (
          <div className="p-4"><Empty title="No staff yet" body="Add staff and set their weekly hours." action={manage ? { href: `${base}/staff`, label: "Staff" } : undefined} /></div>
        ) : shown.length === 0 ? (
          <div className="p-4"><Empty title={`No one under “${peopleLabel}”`} body="Pick another group in the People filter." /></div>
        ) : period === "month" ? (
          <MonthGrid coverage={coverage} month={month} people={coverage.staff.filter((s) => shown.some((p) => p.id === s.id))} today={today} hoursHref={hoursHref} weekHref={weekHref} />
        ) : (
          <CoverageGrid coverage={coverage} today={today} hoursHref={hoursHref} mode={view} />
        )}
        {/* Coverage gaps are judged per week; the month is a roster, so it has none. */}
        {period === "week" ? (
          <div className="border-t border-stone-200">
            <h3 className="px-4 pt-3 text-xs font-semibold uppercase tracking-wide text-stone-500">Needs attention this week</h3>
            <CoverageGaps coverage={coverage} />
          </div>
        ) : null}
        <p className="border-t border-stone-100 px-4 py-2 text-xs text-stone-500">
          Rotations, time off and custom hours are already applied.
          {period === "month" ? ` Click a date to open that week.${manage ? " Click a name to change their hours." : ""}` : ` Only providers count towards coverage; a service nobody is assigned to counts as something every provider can do.${view === "coverage" ? " Switch to People to see who is in each hour." : manage ? " Click a person's block to change their hours." : ""}`}
        </p>
      </Card>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <Card className="min-w-0">
          <div className="flex items-center justify-between gap-3 border-b border-stone-200 px-4 py-2">
            <h2 className="text-sm font-semibold text-stone-600">Time off in the next 90 days{peopleFilter ? <span className="font-normal text-stone-500"> · {peopleLabel}</span> : null}</h2>
            {manage ? <LinkButton href={`${base}/staff-hours/time-off`} size="sm"><Plus className="h-4 w-4" /> Add time off</LinkButton> : null}
          </div>
          {groups.length === 0 ? (
            <div className="p-4"><Empty title="Nothing scheduled" body={`Days off and custom hours added under a person's Time off show here${peopleFilter ? ` (showing ${peopleLabel.toLowerCase()} only)` : ""}.`} /></div>
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
