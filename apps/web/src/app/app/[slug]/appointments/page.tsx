import type { Metadata } from "next";
import Link from "next/link";
import { Plus } from "lucide-react";
import { asc, eq } from "drizzle-orm";
import { schema, withTenant } from "@angelic/db";
import { can, instantToISODate, zonedToInstant } from "@angelic/core";
import { requireAction } from "@/lib/tenant";
import { listAppointments, type AppointmentsView } from "@/server/appointments";
import { listLocations } from "@/server/locations";
import { cn, shiftISODate } from "@/lib/utils";
import { relative } from "@/lib/format";
import { Button, Card, Empty, Input, LinkButton, PageHeader, Select } from "@/components/ui";
import { LinkRow } from "@/components/table-row";
import { StatusBadge } from "@/components/status-badge";
import { LocationFilter } from "@/components/location-filter";

export const metadata: Metadata = { title: "Appointments" };

type SP = { view?: string; source?: string; status?: string; staff?: string; location?: string; q?: string; page?: string };
const VIEWS: { key: AppointmentsView; label: string }[] = [
  { key: "upcoming", label: "Upcoming" },
  { key: "today", label: "Today" },
  { key: "recent", label: "Recently booked" },
  { key: "past", label: "Past" },
];
const SOURCES = [["", "Booked anyhow"], ["online", "Booked online"], ["staff", "Booked by staff"], ["import", "Imported"]] as const;
const STATUSES = ["booked", "confirmed", "checked_in", "in_progress", "completed", "no_show", "cancelled"];
const SOURCE_LABEL: Record<string, string> = { online: "online", staff: "by staff", import: "imported" };

/** Every client visit as a row: the place to answer "what came in overnight?" and "what's on next week?". */
export default async function AppointmentsPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<SP> }) {
  const { slug } = await params;
  const sp = await searchParams;
  const { business, permissions } = await requireAction(slug, "appointments.read.any");
  const tz = business.timezone;
  const today = instantToISODate(new Date(), tz);
  const [locations, providers] = await Promise.all([
    listLocations(business.id),
    withTenant(business.id, (tx) => tx.select({ id: schema.staff.id, name: schema.staff.displayName }).from(schema.staff).where(eq(schema.staff.takesAppointments, true)).orderBy(asc(schema.staff.sortOrder), asc(schema.staff.displayName))),
  ]);
  const view = (VIEWS.some((v) => v.key === sp.view) ? sp.view : "upcoming") as AppointmentsView;
  const source = sp.source === "online" || sp.source === "staff" || sp.source === "import" ? sp.source : null;
  const status = STATUSES.includes(sp.status ?? "") ? sp.status! : null;
  const staffId = providers.some((p) => p.id === sp.staff) ? sp.staff! : null;
  const locationId = locations.some((l) => l.id === sp.location) ? sp.location! : null;
  const q = sp.q?.trim() || null;
  const page = Math.max(1, Number(sp.page ?? 1) || 1);
  const { rows, total, pageSize } = await listAppointments(business.id, { view, dayStart: zonedToInstant(today, "00:00", tz), dayEnd: zonedToInstant(shiftISODate(today, 1), "00:00", tz), source, status, staffId, locationId, q, page });
  const pages = Math.max(1, Math.ceil(total / pageSize));

  const params_ = (over: Partial<Record<keyof SP, string | null | undefined>> = {}) => {
    const all: Record<string, string | null | undefined> = { view, source, status, staff: staffId, location: locationId, q, ...over };
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(all)) if (v) p.set(k, v);
    return p.toString();
  };
  const href = (over: Partial<Record<keyof SP, string | null | undefined>> = {}) => `?${params_(over)}`;
  const filtered = !!(source || status || staffId || q);
  const when = new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: tz });
  const time = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone: tz });
  const locName = (id: string | null) => (id ? (locations.find((l) => l.id === id)?.name ?? "").replace(/^.*? - /, "") : "");
  const emptyTitle = view === "today" ? "Nothing on today" : view === "upcoming" ? "Nothing booked ahead" : view === "recent" ? "No bookings yet" : "No past appointments";

  return (
    <>
      <PageHeader title="Appointments">
        {can(permissions, "appointments.write.any") ? <LinkButton href={`/app/${slug}/appointments/new`} variant="primary" size="sm"><Plus className="h-4 w-4" /> New appointment</LinkButton> : null}
      </PageHeader>

      <Card className="mb-4 p-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex rounded-lg border border-stone-300 bg-white p-0.5 text-sm" role="group" aria-label="Which appointments">
            {VIEWS.map((v) => (
              <Link key={v.key} href={href({ view: v.key, page: null })} className={cn("whitespace-nowrap rounded-md px-3 py-1", view === v.key ? "bg-stone-900 text-white" : "text-stone-700 hover:bg-stone-50")}>{v.label}</Link>
            ))}
          </div>
          <LocationFilter locations={locations} current={locationId} query={params_({ location: null, page: null })} allLabel="All" />
          <form method="get" className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
            <input type="hidden" name="view" value={view} />
            {locationId ? <input type="hidden" name="location" value={locationId} /> : null}
            <Select name="source" defaultValue={source ?? ""} aria-label="How it was booked" className="h-9 w-auto">
              {SOURCES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </Select>
            <Select name="status" defaultValue={status ?? ""} aria-label="Status" className="h-9 w-auto">
              <option value="">Any status</option>
              {STATUSES.map((s) => <option key={s} value={s}>{s.replace("_", " ")}</option>)}
            </Select>
            {providers.length > 1 ? (
              <Select name="staff" defaultValue={staffId ?? ""} aria-label="Provider" className="h-9 w-auto">
                <option value="">Any provider</option>
                {providers.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </Select>
            ) : null}
            <Input name="q" defaultValue={q ?? ""} placeholder="Client, phone or service" className="h-9 min-w-0 flex-1 basis-40" aria-label="Search" />
            <Button type="submit" size="sm" variant="secondary">Apply</Button>
            {filtered ? <Link href={href({ source: null, status: null, staff: null, q: null, page: null })} className="text-sm text-stone-600 underline">Clear</Link> : null}
          </form>
        </div>
      </Card>

      {rows.length === 0 ? (
        <Empty title={emptyTitle} body={filtered ? "Try clearing a filter." : view === "recent" ? "Online bookings and ones the desk enters both show here, newest first." : undefined} />
      ) : (
        <Card>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase tracking-wide text-stone-500">
                <tr>
                  <th className="px-4 py-2">When</th>
                  <th className="px-4 py-2">Client</th>
                  <th className="px-4 py-2">Service</th>
                  <th className="px-4 py-2">Provider</th>
                  {locations.length > 1 ? <th className="px-4 py-2">Location</th> : null}
                  <th className="px-4 py-2">Booked</th>
                  <th className="px-4 py-2">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-200">
                {rows.map((r) => {
                  const client = `${r.firstName ?? ""} ${r.lastName ?? ""}`.trim();
                  const start = new Date(r.startAt);
                  const end = new Date(r.endAt);
                  return (
                    <LinkRow key={r.id} href={`/app/${slug}/appointments/${r.id}`}>
                      <td className="whitespace-nowrap px-4 py-2">
                        <Link href={`/app/${slug}/appointments/${r.id}`} className="font-medium text-stone-900 hover:underline">{when.format(start)}</Link>
                        <span className="block text-xs text-stone-500">{time.format(start)} – {time.format(end)}</span>
                      </td>
                      <td className="px-4 py-2">{client || <span className="text-stone-500">Walk-in</span>}</td>
                      <td className="max-w-[18rem] truncate px-4 py-2 text-stone-700" title={r.services ?? ""}>{r.services}</td>
                      <td className="whitespace-nowrap px-4 py-2 text-stone-700">{r.staffName ?? ""}{Number(r.staffCount) > 1 ? <span className="text-stone-500"> +{Number(r.staffCount) - 1}</span> : null}</td>
                      {locations.length > 1 ? <td className="whitespace-nowrap px-4 py-2 text-stone-600">{locName(r.locationId)}</td> : null}
                      <td className="whitespace-nowrap px-4 py-2 text-stone-600">
                        {r.source === "online" ? <span className="mr-1.5 inline-flex items-center rounded-full bg-brand-50 px-2 py-0.5 text-xs font-medium text-brand-700 ring-1 ring-inset ring-brand-200">online</span> : <span className="mr-1.5 text-xs text-stone-500">{SOURCE_LABEL[r.source] ?? r.source}</span>}
                        <span className="text-xs" title={new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: tz }).format(r.createdAt)}>{relative(r.createdAt)}</span>
                      </td>
                      <td className="px-4 py-2"><StatusBadge status={r.status} /></td>
                    </LinkRow>
                  );
                })}
              </tbody>
            </table>
          </div>
          {pages > 1 ? (
            <div className="flex items-center justify-between border-t border-stone-200 px-4 py-2 text-sm text-stone-600">
              <span>{total} appointments</span>
              <span className="flex gap-2">
                {page > 1 ? <Link href={href({ page: String(page - 1) })} className="underline">Previous</Link> : null}
                {page < pages ? <Link href={href({ page: String(page + 1) })} className="underline">Next</Link> : null}
              </span>
            </div>
          ) : null}
        </Card>
      )}
    </>
  );
}
