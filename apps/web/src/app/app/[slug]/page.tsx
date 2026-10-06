import { instantToISODate } from "@angelic/core";
import { getRangeAgenda } from "@/server/agenda";
import { requireBusiness } from "@/lib/tenant";
import { formatDateLong, shiftISODate } from "@/lib/utils";
import { LinkButton, PageHeader, Empty } from "@/components/ui";
import { CalendarGrid, type CalColumn, type CalItem } from "./calendar-grid";
import { can } from "@angelic/core";

function startOfWeek(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  const dow = new Date(Date.UTC(y!, m! - 1, d!)).getUTCDay(); // 0 = Sunday
  return shiftISODate(date, -((dow + 6) % 7)); // Monday
}

export default async function CalendarPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ date?: string; view?: string; staff?: string }>;
}) {
  const { slug } = await params;
  const sp = await searchParams;
  const { business, role } = await requireBusiness(slug);
  const tz = business.timezone;
  const today = instantToISODate(new Date(), tz);
  const date = /^\d{4}-\d{2}-\d{2}$/.test(sp.date ?? "") ? sp.date! : today;
  const view = sp.view === "week" ? "week" : "day";
  const from = view === "week" ? startOfWeek(date) : date;
  const days = view === "week" ? 7 : 1;
  const { staff, items } = await getRangeAgenda(business.id, tz, from, days);
  const staffFilter = staff.some((s) => s.id === sp.staff) ? sp.staff! : null;

  const minuteOf = (d: Date) => {
    const parts = new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", minute: "numeric", hour12: false }).formatToParts(d);
    const h = Number(parts.find((p) => p.type === "hour")!.value) % 24;
    return h * 60 + Number(parts.find((p) => p.type === "minute")!.value);
  };

  const columns: CalColumn[] =
    view === "day"
      ? staff.map((s) => ({ key: s.id, label: s.displayName, color: s.color, date, staffId: s.id }))
      : Array.from({ length: 7 }, (_, i) => {
          const d = shiftISODate(from, i);
          return {
            key: d,
            label: new Intl.DateTimeFormat("en-US", { weekday: "short", month: "numeric", day: "numeric", timeZone: "UTC" }).format(new Date(d + "T00:00:00Z")),
            date: d,
            staffId: staffFilter,
            isToday: d === today,
          };
        });

  const staffById = new Map(staff.map((s) => [s.id, s]));
  const calItems: CalItem[] = items
    .filter((i) => !staffFilter || i.staffId === staffFilter)
    .map((i) => ({
      id: i.id,
      appointmentId: i.appointmentId,
      staffId: i.staffId,
      columnKey: view === "day" ? i.staffId : instantToISODate(i.startAt, tz),
      startMin: minuteOf(i.startAt),
      endMin: minuteOf(i.endAt) <= minuteOf(i.startAt) ? 24 * 60 : minuteOf(i.endAt),
      title: i.clientName ?? "Walk-in",
      subtitle: i.serviceName,
      status: i.status,
      color: staffById.get(i.staffId)?.color ?? "#6366f1",
      href: `/app/${slug}/appointments/${i.appointmentId}`,
    }));

  const nav = (d: string) => `?view=${view}&date=${d}${staffFilter ? `&staff=${staffFilter}` : ""}`;
  const step = view === "week" ? 7 : 1;
  const title = view === "week" ? `Week of ${formatDateLong(from)}` : formatDateLong(date);

  return (
    <>
      <PageHeader title={title}>
        <div className="flex rounded-lg border border-stone-300 bg-white p-0.5 text-sm">
          <a href={`?view=day&date=${date}`} className={`rounded-md px-3 py-1 ${view === "day" ? "bg-stone-900 text-white" : "text-stone-700"}`}>Day</a>
          <a href={`?view=week&date=${date}`} className={`rounded-md px-3 py-1 ${view === "week" ? "bg-stone-900 text-white" : "text-stone-700"}`}>Week</a>
        </div>
        {view === "week" ? (
          <form className="contents">
            <input type="hidden" name="view" value="week" />
            <input type="hidden" name="date" value={date} />
            <select name="staff" defaultValue={staffFilter ?? ""} className="h-8 rounded-lg border border-stone-300 bg-white px-2 text-sm">
              <option value="">All staff</option>
              {staff.map((s) => (
                <option key={s.id} value={s.id}>{s.displayName}</option>
              ))}
            </select>
            <button className="h-8 rounded-lg border border-stone-300 bg-white px-3 text-sm">Go</button>
          </form>
        ) : null}
        <LinkButton href={nav(shiftISODate(date, -step))} size="sm">‹</LinkButton>
        <LinkButton href={nav(today)} size="sm" variant={date === today ? "ghost" : "secondary"}>Today</LinkButton>
        <LinkButton href={nav(shiftISODate(date, step))} size="sm">›</LinkButton>
        {can(role, "appointments.write.any") ? (
          <LinkButton href={`/app/${slug}/appointments/new?date=${date}`} variant="primary" size="sm">+ New appointment</LinkButton>
        ) : null}
      </PageHeader>

      {staff.length === 0 ? (
        <Empty title="No staff yet" body="Add a staff member before booking appointments." />
      ) : (
        <CalendarGrid
          slug={slug}
          timeZone={tz}
          view={view}
          columns={columns}
          items={calItems}
          slotIntervalMin={business.slotIntervalMin}
          canEdit={can(role, "appointments.write.any")}
        />
      )}
    </>
  );
}
