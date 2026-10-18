import type { Metadata } from "next";
import { cookies } from "next/headers";
import { Ban, ChevronLeft, ChevronRight, Plus } from "lucide-react";
import { instantToISODate, weekdayOf } from "@angelic/core";

export const metadata: Metadata = { title: "Calendar" };
import { filterAgendaByLocation, getRangeAgenda } from "@/server/agenda";
import { workingBlocksFor } from "@/server/availability";
import { tzFor } from "@/server/locations";
import { appointmentsMissingForms } from "@/server/forms";
import { requireBusiness } from "@/lib/tenant";
import { formatDateLong, shiftISODate } from "@/lib/utils";
import { LinkButton, PageHeader, Empty } from "@/components/ui";
import { CalendarGrid, type CalColumn, type CalItem } from "./calendar-grid";
import { AutoSubmitForm } from "@/components/auto-submit-form";
import { MonthGrid } from "./month-grid";
import { SetupChecklist, type SetupStep } from "./setup-checklist";
import { TodayStrip } from "./today-strip";
import { LocationPills } from "./location-pills";
import { money } from "@/lib/format";
import { sql } from "drizzle-orm";
import { can } from "@angelic/core";
import { asc, eq } from "drizzle-orm";
import { db, schema, withTenant } from "@angelic/db";
import { buildTip, type CalTip, type TipItem } from "@/lib/calendar-tip";
import { blockingAccess, bookingAccess, seesNoCalendar, seesOwnOnly } from "@/lib/appointment-access";

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
  searchParams: Promise<{ date?: string; view?: string; staff?: string; location?: string; forms?: string }>;
}) {
  const { slug } = await params;
  const sp = await searchParams;
  const { business, permissions, user, staffId, plan } = await requireBusiness(slug);
  // A Provider's calendar is their own: their column and their appointments. A role with no calendar permission at all sees none.
  const ownOnly = seesOwnOnly(permissions);
  // New appointments: for anyone (front desk, manager), or on their own calendar if the role has that permission.
  const canBook = !!bookingAccess(permissions, staffId ?? null);
  const canBlock = !!blockingAccess(permissions, staffId ?? null);
  const noCalendar = seesNoCalendar(permissions);
  const locations = await withTenant(business.id, (tx) => tx.select().from(schema.locations).orderBy(asc(schema.locations.name)));
  const locationFilter = locations.some((l) => l.id === sp.location) ? sp.location! : null;
  // Filtered to one location: show its wall clock (it may sit in another timezone).
  const tz = tzFor(business, locationFilter ? locations.find((l) => l.id === locationFilter) : null);
  const today = instantToISODate(new Date(), tz);
  const date = /^\d{4}-\d{2}-\d{2}$/.test(sp.date ?? "") ? sp.date! : today;
  const view = sp.view === "week" ? "week" : sp.view === "month" ? "month" : "day";
  const monthStart = `${date.slice(0, 7)}-01`;
  const daysInMonth = new Date(Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)), 0)).getUTCDate();
  const from = view === "week" ? startOfWeek(date) : view === "month" ? monthStart : date;
  const days = view === "week" ? 7 : view === "month" ? daysInMonth : 1;
  const agenda = await getRangeAgenda(business.id, tz, from, days);
  // Day view: who works at this location on that weekday; week/month: anyone who works there on some day.
  const filtered = filterAgendaByLocation(agenda, locationFilter, view === "day" ? weekdayOf(date) : null);
  const agendaItems = noCalendar ? [] : ownOnly ? filtered.items.filter((i) => i.staffId === staffId) : filtered.items;
  const staff = noCalendar ? [] : ownOnly ? filtered.staff.filter((s) => s.id === staffId) : filtered.staff;
  // Which visits still have a required form outstanding (day view only: it's a per-appointment check).
  const missingForms = view === "day" ? await withTenant(business.id, (tx) => appointmentsMissingForms(tx, [...new Set(agendaItems.filter((i) => !i.classSessionId).map((i) => i.appointmentId))])) : new Set<string>();
  const formsFilter = sp.forms === "missing";
  const items = formsFilter ? agendaItems.filter((i) => missingForms.has(i.appointmentId)) : agendaItems;
  // The week opens on the overview of everyone: each appointment is a text-free block in its stylist's colour, read by hover or click. Picking
  // a stylist (staff=<id>) shows that one person's week in full. Day view shows every column, month view everyone.
  const staffFilter = view === "week" ? (ownOnly ? (staff[0]?.id ?? null) : (staff.find((s) => s.id === sp.staff)?.id ?? null)) : null;
  const staffParam = view === "week" ? (staffFilter ?? "all") : null;
  const overview = view === "week" && !staffFilter && !ownOnly && !noCalendar;

  const minuteOf = (d: Date) => {
    const parts = new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", minute: "numeric", hour12: false }).formatToParts(d);
    const h = Number(parts.find((p) => p.type === "hour")!.value) % 24;
    return h * 60 + Number(parts.find((p) => p.type === "minute")!.value);
  };

  // Working hours per column: each provider's blocks (day view), one provider's week, or everyone's union per day.
  const gridDates = view === "week" ? Array.from({ length: 7 }, (_, i) => shiftISODate(from, i)) : [date];
  const blocks = view === "month" ? new Map<string, { start: Date; end: Date }[]>() : await workingBlocksFor({ businessId: business.id, timeZone: tz, staffIds: staff.map((s) => s.id), dates: gridDates, locationId: locationFilter });
  const toMinutes = (b: { start: Date; end: Date }) => ({ startMin: minuteOf(b.start), endMin: minuteOf(b.end) <= minuteOf(b.start) ? 24 * 60 : minuteOf(b.end) });
  const unionFor = (d: string) => {
    const all = staff.flatMap((s) => (blocks.get(`${s.id}:${d}`) ?? []).map(toMinutes)).sort((a, b) => a.startMin - b.startMin);
    const merged: { startMin: number; endMin: number }[] = [];
    for (const b of all) {
      const last = merged[merged.length - 1];
      if (last && b.startMin <= last.endMin) last.endMin = Math.max(last.endMin, b.endMin);
      else merged.push({ ...b });
    }
    return merged;
  };
  const columns: CalColumn[] =
    view !== "week"
      ? staff.map((s) => ({ key: s.id, label: s.displayName, color: s.color, date, staffId: s.id, working: (blocks.get(`${s.id}:${date}`) ?? []).map(toMinutes) }))
      : Array.from({ length: 7 }, (_, i) => {
          const d = shiftISODate(from, i);
          return {
            key: d,
            label: new Intl.DateTimeFormat("en-US", { weekday: "short", month: "numeric", day: "numeric", timeZone: "UTC" }).format(new Date(d + "T00:00:00Z")),
            date: d,
            staffId: staffFilter,
            isToday: d === today,
            working: staffFilter ? (blocks.get(`${staffFilter}:${d}`) ?? []).map(toMinutes) : unionFor(d),
          };
        });

  // The grid shows 7am–9pm by default and widens to fit early/late hours or bookings.
  const minutesSeen = [...columns.flatMap((c) => (c.working ?? []).flatMap((w) => [w.startMin, w.endMin])), ...items.filter((i) => i.status !== "cancelled").flatMap((i) => [minuteOf(i.startAt), minuteOf(i.endAt) <= minuteOf(i.startAt) ? 24 * 60 : minuteOf(i.endAt)])];
  const startHour = Math.max(0, Math.min(7, ...minutesSeen.map((m) => Math.floor(m / 60))));
  const endHour = Math.min(24, Math.max(21, ...minutesSeen.map((m) => Math.ceil(m / 60))));
  const staffById = new Map(staff.map((s) => [s.id, s]));
  // One hover card per appointment: every service on the visit, who does it, the client, and anything to know.
  const tipRows = new Map<string, TipItem[]>();
  for (const i of items) {
    const row: TipItem = {
      appointmentId: i.appointmentId, serviceName: i.serviceName, staffName: staffById.get(i.staffId)?.displayName ?? "", startMin: minuteOf(i.startAt),
      endMin: minuteOf(i.endAt) <= minuteOf(i.startAt) ? 24 * 60 : minuteOf(i.endAt), priceCents: i.priceCents, status: i.status, kind: i.kind, clientName: i.clientName,
      clientPhone: i.clientPhone, clientTags: i.clientTags, source: i.source, depositCents: i.depositCents, depositStatus: i.depositStatus, notes: i.notes,
      classSessionId: i.classSessionId, seats: i.seats, allowOverlap: i.allowOverlap,
    };
    tipRows.set(i.appointmentId, [...(tipRows.get(i.appointmentId) ?? []), row]);
  }
  const tipCache = new Map<string, CalTip>();
  const tipFor = (appointmentId: string) => {
    if (!tipCache.has(appointmentId)) tipCache.set(appointmentId, buildTip(tipRows.get(appointmentId)!, { money: (c) => money(c, business.currency), formsDue: missingForms.has(appointmentId) }));
    return tipCache.get(appointmentId)!;
  };
  const calItems: CalItem[] = items
    .filter((i) => !staffFilter || i.staffId === staffFilter)
    .map((i) => ({
      id: i.id,
      appointmentId: i.appointmentId,
      staffId: i.staffId,
      columnKey: view === "day" ? i.staffId : instantToISODate(i.startAt, tz),
      startMin: minuteOf(i.startAt),
      endMin: minuteOf(i.endAt) <= minuteOf(i.startAt) ? 24 * 60 : minuteOf(i.endAt),
      title: i.kind === "block" ? i.serviceName.replace(/^Blocked( · )?/, "") || "Blocked" : (i.clientName ?? "Walk-in"),
      subtitle: i.kind === "block" ? "Blocked time" : (i.classSessionId ? "Class" : i.serviceName.replace(" (finish)", "")) + (missingForms.has(i.appointmentId) ? " · forms due" : ""),
      status: i.kind === "block" && i.status !== "cancelled" ? "block" : i.status,
      color: staffById.get(i.staffId)?.color ?? "#6366f1",
      href: i.classSessionId ? `/app/${slug}/classes/${i.classSessionId}` : `/app/${slug}/appointments/${i.appointmentId}`,
      groupKey: `${i.appointmentId}:${i.serviceName.replace(" (finish)", "")}:${i.staffId}:${instantToISODate(i.startAt, tz)}`,
      tip: tipFor(i.appointmentId),
    }));

  let setup: SetupStep[] = [];
  const setupHidden = (await cookies()).get(`setup-hidden-${business.id}`)?.value === "1";
  if (can(permissions, "business.manage") && !setupHidden) {
    const counts = await withTenant(business.id, async (tx) => {
      const [svc] = await tx.select({ n: sql<number>`count(*)` }).from(schema.services);
      const [st] = await tx.select({ n: sql<number>`count(*)` }).from(schema.staff);
      const [ap] = await tx.select({ n: sql<number>`count(*)` }).from(schema.appointments);
      const [cl] = await tx.select({ n: sql<number>`count(*)` }).from(schema.clients);
      const [sms] = await tx.select({ n: sql<number>`count(*)` }).from(schema.messagingNumbers).where(sql`released_at is null`);
      return { services: Number(svc?.n ?? 0), staff: Number(st?.n ?? 0), appointments: Number(ap?.n ?? 0), clients: Number(cl?.n ?? 0), smsNumber: Number(sms?.n ?? 0) > 0 };
    });
    const me = await db.query.user.findFirst({ where: eq(schema.user.id, user.id), columns: { emailVerified: true, twoFactorEnabled: true } });
    setup = [
      ...(business.publishRequiresVerified ? [{ key: "verify", label: "Verify your email", href: `/account`, done: !!me?.emailVerified, hint: "Until then your booking page stays closed and no messages go out." }] : []),
      { key: "services", label: "Add your services", href: `/app/${slug}/services/new`, done: counts.services > 0, hint: "What clients can book." },
      { key: "staff", label: "Add your team", href: `/app/${slug}/staff/new`, done: counts.staff > 1, hint: "Everyone gets a calendar column." },
      { key: "profile", label: "Brand your booking page", href: `/app/${slug}/settings/profile`, done: !!(business.tagline || business.logoUrl || business.brandColor), hint: "Logo, colour and hours." },
      ...(can(permissions, "billing.manage") ? [{ key: "stripe", label: "Connect Stripe", href: `/app/${slug}/settings/payments`, done: business.stripeChargesEnabled, hint: "Take cards and save cards on file." }] : []),
      ...(can(permissions, "integrations.manage") ? [{ key: "sms", label: "Get a text number", href: `/app/${slug}/settings/messaging`, done: counts.smsNumber, hint: "Reminders by SMS from your own number." }] : []),
      { key: "clients", label: "Import clients from Vagaro", href: `/app/${slug}/settings/import`, done: counts.clients > 3, hint: "CSV or Excel export." },
      { key: "booking", label: "Share your booking link", href: `/app/${slug}/settings/booking`, done: counts.appointments > 0 && business.onlineBookingEnabled, hint: "Put it on Instagram and Google." },
      ...(plan.state === "trial" && can(permissions, "billing.manage") ? [{ key: "plan", label: "Add a card", href: `/app/${slug}/settings/billing`, done: false, hint: `Your trial ends in ${plan.daysLeft} day${plan.daysLeft === 1 ? "" : "s"}; nothing is charged until then.` }] : []),
      { key: "2fa", label: "Turn on two-factor sign-in", href: `/account`, done: !!me?.twoFactorEnabled, hint: "An extra code at sign-in protects your clients and your money." },
    ];
  }
  const nav = (d: string) => `?view=${view}&date=${d}${staffParam ? `&staff=${staffParam}` : ""}${locationFilter ? `&location=${locationFilter}` : ""}${formsFilter ? "&forms=missing" : ""}`;
  // Switching views keeps the location (and the staff pick when going to the week).
  const viewHref = (v: "day" | "week" | "month") => `?view=${v}&date=${date}${v === "week" && sp.staff ? `&staff=${sp.staff}` : ""}${locationFilter ? `&location=${locationFilter}` : ""}`;
  const step = view === "week" ? 7 : view === "month" ? daysInMonth : 1;
  // The button back to now is named for the view (a week or a month is not "today"). Away from now it says where it goes
  // ("Back to today"), so it never reads as a label for the date on screen; at now it is a quiet "Today".
  const atNow = view === "week" ? from === startOfWeek(today) : view === "month" ? date.slice(0, 7) === today.slice(0, 7) : date === today;
  const nowName = view === "week" ? "this week" : view === "month" ? "this month" : "today";
  const nowLabel = atNow ? nowName.charAt(0).toUpperCase() + nowName.slice(1) : `Back to ${nowName}`;
  const title = view === "week" ? `Week of ${formatDateLong(from)}` : view === "month" ? new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(monthStart + "T00:00:00Z")) : formatDateLong(date);

  return (
    <>
      <PageHeader title={title}>
        <div className="flex rounded-lg border border-stone-300 bg-white p-0.5 text-sm">
          <a href={viewHref("day")} className={`rounded-md px-3 py-1 ${view === "day" ? "bg-stone-900 text-white" : "text-stone-700"}`}>Day</a>
          <a href={viewHref("week")} className={`rounded-md px-3 py-1 ${view === "week" ? "bg-stone-900 text-white" : "text-stone-700"}`}>Week</a>
          <a href={viewHref("month")} className={`rounded-md px-3 py-1 ${view === "month" ? "bg-stone-900 text-white" : "text-stone-700"}`}>Month</a>
        </div>
        {/* Fixed place, whatever the view: Prev, a button back to now named for the view, Next. Optional controls follow it. */}
        <div className="flex items-center gap-1">
          <LinkButton href={nav(shiftISODate(date, -step))} size="sm" aria-label={`Previous ${view}`}><ChevronLeft className="h-4 w-4" /></LinkButton>
          <LinkButton href={nav(today)} size="sm" variant={atNow ? "ghost" : "secondary"} aria-current={atNow ? "date" : undefined}>{nowLabel}</LinkButton>
          <LinkButton href={nav(shiftISODate(date, step))} size="sm" aria-label={`Next ${view}`}><ChevronRight className="h-4 w-4" /></LinkButton>
        </div>
        {locations.length > 1 ? (
          <LocationPills businessId={business.id} locations={locations.map((l) => ({ id: l.id, name: l.name }))} current={locationFilter} query={`view=${view}&date=${date}${staffParam ? `&staff=${staffParam}` : ""}`} />
        ) : null}
        {canBlock ? (
          <LinkButton href={`/app/${slug}/appointments/block?date=${date}${locationFilter ? `&location=${locationFilter}` : ""}`} variant="secondary" size="sm"><Ban className="h-4 w-4" /> <span className="hidden sm:inline">Block time</span></LinkButton>
        ) : null}
        {canBook ? (
            <LinkButton href={`/app/${slug}/appointments/new?date=${date}${locationFilter ? `&location=${locationFilter}` : ""}`} variant="primary" size="sm"><Plus className="h-4 w-4" /> <span className="hidden sm:inline">New appointment</span><span className="sm:hidden">New</span></LinkButton>
        ) : null}
      </PageHeader>

      {setup.length ? <SetupChecklist steps={setup} slug={slug} /> : null}
      {noCalendar ? (
        <p className="mb-4 rounded-lg border border-stone-200 bg-white px-4 py-3 text-sm text-stone-600">Your role doesn&apos;t include calendars. Ask the owner if you need access.</p>
      ) : ownOnly && !staffId ? (
        <p className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">Your login isn&apos;t linked to a staff member yet, so there is no calendar to show. Ask the owner to send you an invitation from Staff, or to link it under Staff → Access.</p>
      ) : null}
      {view === "week" && !ownOnly && !noCalendar ? (
        // The week's own controls live here, not in the header, so the header is the same in every view and nothing in it moves.
        <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-stone-600">
          <AutoSubmitForm className="contents">
            <input type="hidden" name="view" value="week" />
            <input type="hidden" name="date" value={date} />
            {locationFilter ? <input type="hidden" name="location" value={locationFilter} /> : null}
            <select name="staff" defaultValue={staffParam ?? "all"} aria-label="Whose week" className="h-8 rounded-lg border border-stone-300 bg-white px-2 text-sm text-stone-900">
              <option value="all">Everyone (overview)</option>
              {staff.map((s) => (
                <option key={s.id} value={s.id}>{s.displayName}</option>
              ))}
            </select>
          </AutoSubmitForm>
          {overview ? (
            <p className="flex flex-wrap items-center gap-x-4 gap-y-1" aria-label="Colours">
              {staff.map((s) => (
                <span key={s.id} className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full" style={{ background: s.color ?? "#6366f1" }} />{s.displayName}</span>
              ))}
              <span className="text-stone-400">Hover an appointment for details, click to open it.</span>
            </p>
          ) : null}
        </div>
      ) : null}
      {view === "day" ? (
        <TodayStrip
          date={date}
          isToday={date === today}
          stats={(() => {
            const live = items.filter((i) => i.status !== "cancelled" && i.kind !== "block");
            const byAppt = new Map<string, (typeof live)[number]>();
            for (const i of live) if (!byAppt.has(i.appointmentId)) byAppt.set(i.appointmentId, i);
            const appts = [...byAppt.values()];
            return {
              appointments: appts.length,
              unconfirmed: appts.filter((a) => a.status === "booked").length,
              completed: appts.filter((a) => a.status === "completed").length,
              noShows: appts.filter((a) => a.status === "no_show").length,
              expected: can(permissions, "reports.view") ? money(live.filter((i) => i.status !== "no_show").reduce((s, i) => s + i.priceCents, 0), business.currency) : null,
              nextUp: appts.filter((a) => a.startAt > new Date() && (a.status === "booked" || a.status === "confirmed")).sort((a, b) => a.startAt.getTime() - b.startAt.getTime())[0] ?? null,
              formsMissing: missingForms.size,
            };
          })()}
          tz={tz}
          slug={slug}
          formsHref={formsFilter ? nav(date).replace("&forms=missing", "") : `${nav(date)}&forms=missing`}
          formsFilterOn={formsFilter}
        />
      ) : null}
      {staff.length === 0 && locationFilter ? (
        <Empty title={`Nobody works at ${locations.find((l) => l.id === locationFilter)?.name ?? "this location"} ${view === "day" ? "on this day" : "yet"}`} body="Set each provider's location per weekday under Staff → Weekly hours." action={{ href: `/app/${slug}/staff`, label: "Open Staff" }} />
      ) : staff.length === 0 ? (
        <Empty title="No staff yet" body="Add a staff member before booking appointments." action={{ href: `/app/${slug}/staff/new`, label: "Add a staff member" }} />
      ) : view === "month" ? (
        <MonthGrid monthStart={monthStart} daysInMonth={daysInMonth} today={today} items={calItems.filter((i) => i.status !== "cancelled")} staff={staff} slug={slug} staffFilter={staffFilter} />
      ) : (
        <CalendarGrid
          todayISO={today}
          overview={overview}
          slug={slug}
          timeZone={tz}
          view={view}
          columns={columns}
          items={calItems}
          slotIntervalMin={business.slotIntervalMin}
          canEdit={can(permissions, "appointments.write.any") || (ownOnly && can(permissions, "appointments.write.own"))}
          canMove={can(permissions, "appointments.write.any") || (ownOnly && can(permissions, "appointments.change.own"))}
          canMoveBlock={can(permissions, "appointments.write.any") || (ownOnly && can(permissions, "appointments.block.own"))}
          canBook={canBook}
          startHour={startHour}
          endHour={endHour}
        />
      )}
    </>
  );
}
