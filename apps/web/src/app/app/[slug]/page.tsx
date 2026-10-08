import type { Metadata } from "next";
import { ChevronLeft, ChevronRight, Plus } from "lucide-react";
import { instantToISODate } from "@angelic/core";

export const metadata: Metadata = { title: "Calendar" };
import { getRangeAgenda } from "@/server/agenda";
import { requireBusiness } from "@/lib/tenant";
import { formatDateLong, shiftISODate } from "@/lib/utils";
import { LinkButton, PageHeader, Empty } from "@/components/ui";
import { CalendarGrid, type CalColumn, type CalItem } from "./calendar-grid";
import { MonthGrid } from "./month-grid";
import { SetupChecklist, type SetupStep } from "./setup-checklist";
import { TodayStrip } from "./today-strip";
import { money } from "@/lib/format";
import { sql } from "drizzle-orm";
import { can } from "@angelic/core";
import { asc } from "drizzle-orm";
import { schema, withTenant } from "@angelic/db";

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
  searchParams: Promise<{ date?: string; view?: string; staff?: string; location?: string }>;
}) {
  const { slug } = await params;
  const sp = await searchParams;
  const { business, permissions } = await requireBusiness(slug);
  const tz = business.timezone;
  const today = instantToISODate(new Date(), tz);
  const date = /^\d{4}-\d{2}-\d{2}$/.test(sp.date ?? "") ? sp.date! : today;
  const view = sp.view === "week" ? "week" : sp.view === "month" ? "month" : "day";
  const monthStart = `${date.slice(0, 7)}-01`;
  const daysInMonth = new Date(Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)), 0)).getUTCDate();
  const from = view === "week" ? startOfWeek(date) : view === "month" ? monthStart : date;
  const days = view === "week" ? 7 : view === "month" ? daysInMonth : 1;
  const agenda = await getRangeAgenda(business.id, tz, from, days);
  const locations = await withTenant(business.id, (tx) => tx.select().from(schema.locations).orderBy(asc(schema.locations.name)));
  const locationFilter = locations.some((l) => l.id === sp.location) ? sp.location! : null;
  const staff = locationFilter ? agenda.staff.filter((s) => !s.locationId || s.locationId === locationFilter) : agenda.staff;
  const items = agenda.items.filter((i) => staff.some((s) => s.id === i.staffId));
  const staffFilter = staff.some((s) => s.id === sp.staff) ? sp.staff! : null;

  const minuteOf = (d: Date) => {
    const parts = new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", minute: "numeric", hour12: false }).formatToParts(d);
    const h = Number(parts.find((p) => p.type === "hour")!.value) % 24;
    return h * 60 + Number(parts.find((p) => p.type === "minute")!.value);
  };

  const columns: CalColumn[] =
    view !== "week"
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
      subtitle: i.serviceName.replace(" (finish)", ""),
      status: i.status,
      color: staffById.get(i.staffId)?.color ?? "#6366f1",
      href: `/app/${slug}/appointments/${i.appointmentId}`,
      groupKey: `${i.appointmentId}:${i.serviceName.replace(" (finish)", "")}:${i.staffId}:${instantToISODate(i.startAt, tz)}`,
    }));

  let setup: SetupStep[] = [];
  if (can(permissions, "business.manage")) {
    const counts = await withTenant(business.id, async (tx) => {
      const [svc] = await tx.select({ n: sql<number>`count(*)` }).from(schema.services);
      const [st] = await tx.select({ n: sql<number>`count(*)` }).from(schema.staff);
      const [ap] = await tx.select({ n: sql<number>`count(*)` }).from(schema.appointments);
      const [cl] = await tx.select({ n: sql<number>`count(*)` }).from(schema.clients);
      const [sms] = await tx.select({ n: sql<number>`count(*)` }).from(schema.messagingNumbers).where(sql`released_at is null`);
      return { services: Number(svc?.n ?? 0), staff: Number(st?.n ?? 0), appointments: Number(ap?.n ?? 0), clients: Number(cl?.n ?? 0), smsNumber: Number(sms?.n ?? 0) > 0 };
    });
    setup = [
      { key: "services", label: "Add your services", href: `/app/${slug}/services/new`, done: counts.services > 0, hint: "What clients can book." },
      { key: "staff", label: "Add your team", href: `/app/${slug}/staff/new`, done: counts.staff > 1, hint: "Everyone gets a calendar column." },
      { key: "profile", label: "Brand your booking page", href: `/app/${slug}/settings/profile`, done: !!(business.tagline || business.logoUrl || business.brandColor), hint: "Logo, colour and hours." },
      { key: "stripe", label: "Connect Stripe", href: `/app/${slug}/settings/payments`, done: business.stripeChargesEnabled, hint: "Take cards and save cards on file." },
      { key: "sms", label: "Get a text number", href: `/app/${slug}/settings/messaging`, done: counts.smsNumber, hint: "Reminders by SMS from your own number." },
      { key: "clients", label: "Import clients from Vagaro", href: `/app/${slug}/settings/import`, done: counts.clients > 3, hint: "CSV or Excel export." },
      { key: "booking", label: "Share your booking link", href: `/app/${slug}/settings/booking`, done: counts.appointments > 0 && business.onlineBookingEnabled, hint: "Put it on Instagram and Google." },
    ];
  }
  const nav = (d: string) => `?view=${view}&date=${d}${staffFilter ? `&staff=${staffFilter}` : ""}${locationFilter ? `&location=${locationFilter}` : ""}`;
  const step = view === "week" ? 7 : view === "month" ? daysInMonth : 1;
  const title = view === "week" ? `Week of ${formatDateLong(from)}` : view === "month" ? new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(monthStart + "T00:00:00Z")) : formatDateLong(date);

  return (
    <>
      <PageHeader title={title}>
        <div className="flex rounded-lg border border-stone-300 bg-white p-0.5 text-sm">
          <a href={`?view=day&date=${date}`} className={`rounded-md px-3 py-1 ${view === "day" ? "bg-stone-900 text-white" : "text-stone-700"}`}>Day</a>
          <a href={`?view=week&date=${date}`} className={`rounded-md px-3 py-1 ${view === "week" ? "bg-stone-900 text-white" : "text-stone-700"}`}>Week</a>
          <a href={`?view=month&date=${date}`} className={`rounded-md px-3 py-1 ${view === "month" ? "bg-stone-900 text-white" : "text-stone-700"}`}>Month</a>
        </div>
        {locations.length > 1 ? (
          <form className="contents">
            <input type="hidden" name="view" value={view} />
            <input type="hidden" name="date" value={date} />
            <select name="location" defaultValue={locationFilter ?? ""} className="h-8 rounded-lg border border-stone-300 bg-white px-2 text-sm">
              <option value="">All locations</option>
              {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
            <button className="h-8 rounded-lg border border-stone-300 bg-white px-3 text-sm">Go</button>
          </form>
        ) : null}
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
        <div className="flex items-center gap-1">
          <LinkButton href={nav(shiftISODate(date, -step))} size="sm" aria-label="Previous"><ChevronLeft className="h-4 w-4" /></LinkButton>
          <LinkButton href={nav(today)} size="sm" variant={date === today ? "ghost" : "secondary"}>Today</LinkButton>
          <LinkButton href={nav(shiftISODate(date, step))} size="sm" aria-label="Next"><ChevronRight className="h-4 w-4" /></LinkButton>
        </div>
        {can(permissions, "appointments.write.any") ? (
          <LinkButton href={`/app/${slug}/appointments/new?date=${date}`} variant="primary" size="sm"><Plus className="h-4 w-4" /> <span className="hidden sm:inline">New appointment</span><span className="sm:hidden">New</span></LinkButton>
        ) : null}
      </PageHeader>

      {setup.length ? <SetupChecklist steps={setup} slug={slug} /> : null}
      {view === "day" ? (
        <TodayStrip
          date={date}
          isToday={date === today}
          stats={(() => {
            const live = items.filter((i) => i.status !== "cancelled");
            const byAppt = new Map<string, (typeof live)[number]>();
            for (const i of live) if (!byAppt.has(i.appointmentId)) byAppt.set(i.appointmentId, i);
            const appts = [...byAppt.values()];
            return {
              appointments: appts.length,
              unconfirmed: appts.filter((a) => a.status === "booked").length,
              completed: appts.filter((a) => a.status === "completed").length,
              noShows: appts.filter((a) => a.status === "no_show").length,
              expected: money(live.reduce((s, i) => s + i.priceCents, 0), business.currency),
              nextUp: appts.filter((a) => a.startAt > new Date() && (a.status === "booked" || a.status === "confirmed")).sort((a, b) => a.startAt.getTime() - b.startAt.getTime())[0] ?? null,
            };
          })()}
          tz={tz}
          slug={slug}
        />
      ) : null}
      {staff.length === 0 ? (
        <Empty title="No staff yet" body="Add a staff member before booking appointments." action={{ href: `/app/${slug}/staff/new`, label: "Add a staff member" }} />
      ) : view === "month" ? (
        <MonthGrid monthStart={monthStart} daysInMonth={daysInMonth} today={today} items={calItems.filter((i) => i.status !== "cancelled")} staff={staff} slug={slug} staffFilter={staffFilter} />
      ) : (
        <CalendarGrid
          todayISO={today}
          slug={slug}
          timeZone={tz}
          view={view}
          columns={columns}
          items={calItems}
          slotIntervalMin={business.slotIntervalMin}
          canEdit={can(permissions, "appointments.write.any")}
        />
      )}
    </>
  );
}
