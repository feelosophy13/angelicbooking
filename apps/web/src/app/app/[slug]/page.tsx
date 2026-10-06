import { instantToISODate } from "@angelic/core";
import { getDayAgenda } from "@/server/agenda";
import { requireBusiness } from "@/lib/tenant";
import { formatDateLong, formatTime, shiftISODate, cn } from "@/lib/utils";
import { Button, LinkButton, PageHeader, Empty } from "@/components/ui";
import { updateAppointmentStatus } from "./actions";

const DAY_START_H = 7;
const DAY_END_H = 21;
const PX_PER_MIN = 1.2;

const STATUS_STYLES: Record<string, string> = {
  booked: "bg-brand-100 border-brand-500 text-brand-700",
  confirmed: "bg-sky-100 border-sky-500 text-sky-800",
  checked_in: "bg-amber-100 border-amber-500 text-amber-800",
  in_progress: "bg-orange-100 border-orange-500 text-orange-800",
  completed: "bg-emerald-100 border-emerald-500 text-emerald-800",
  no_show: "bg-stone-100 border-stone-400 text-stone-500 line-through",
  cancelled: "bg-stone-100 border-stone-300 text-stone-400 line-through",
};

export default async function CalendarPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ date?: string }>;
}) {
  const { slug } = await params;
  const sp = await searchParams;
  const { business } = await requireBusiness(slug);
  const tz = business.timezone;
  const today = instantToISODate(new Date(), tz);
  const date = /^\d{4}-\d{2}-\d{2}$/.test(sp.date ?? "") ? sp.date! : today;
  const { staff, items } = await getDayAgenda(business.id, tz, date);

  const totalMin = (DAY_END_H - DAY_START_H) * 60;
  const hours = Array.from({ length: DAY_END_H - DAY_START_H + 1 }, (_, i) => DAY_START_H + i);
  const minuteOf = (d: Date) => {
    const parts = new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", minute: "numeric", hour12: false }).formatToParts(d);
    const h = Number(parts.find((p) => p.type === "hour")!.value) % 24;
    const m = Number(parts.find((p) => p.type === "minute")!.value);
    return (h - DAY_START_H) * 60 + m;
  };

  return (
    <>
      <PageHeader title={formatDateLong(date)}>
        <LinkButton href={`?date=${shiftISODate(date, -1)}`} size="sm">‹</LinkButton>
        <LinkButton href={`?date=${today}`} size="sm" variant={date === today ? "ghost" : "secondary"}>Today</LinkButton>
        <LinkButton href={`?date=${shiftISODate(date, 1)}`} size="sm">›</LinkButton>
        <LinkButton href={`/app/${slug}/appointments/new?date=${date}`} variant="primary" size="sm">+ New appointment</LinkButton>
      </PageHeader>

      {staff.length === 0 ? (
        <Empty title="No staff yet" body="Add a staff member before booking appointments." />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-stone-200 bg-white">
          <div className="grid min-w-[640px]" style={{ gridTemplateColumns: `56px repeat(${staff.length}, minmax(160px, 1fr))` }}>
            <div className="sticky top-0 z-10 border-b border-stone-200 bg-white" />
            {staff.map((s) => (
              <div key={s.id} className="sticky top-0 z-10 flex items-center gap-2 border-b border-l border-stone-200 bg-white px-3 py-2 text-sm font-medium">
                <span className="h-2.5 w-2.5 rounded-full" style={{ background: s.color }} />
                {s.displayName}
              </div>
            ))}

            <div className="relative" style={{ height: totalMin * PX_PER_MIN }}>
              {hours.map((h) => (
                <div key={h} className="absolute right-2 -translate-y-1/2 text-xs text-stone-400" style={{ top: (h - DAY_START_H) * 60 * PX_PER_MIN }}>
                  {new Intl.DateTimeFormat("en-US", { hour: "numeric" }).format(new Date(2000, 0, 1, h))}
                </div>
              ))}
            </div>

            {staff.map((s) => (
              <div key={s.id} className="relative border-l border-stone-200" style={{ height: totalMin * PX_PER_MIN }}>
                {hours.map((h) => (
                  <div key={h} className="absolute inset-x-0 border-t border-stone-100" style={{ top: (h - DAY_START_H) * 60 * PX_PER_MIN }} />
                ))}
                {items
                  .filter((i) => i.staffId === s.id)
                  .map((i) => {
                    const top = Math.max(0, minuteOf(i.startAt)) * PX_PER_MIN;
                    const height = Math.max(18, (minuteOf(i.endAt) - minuteOf(i.startAt)) * PX_PER_MIN - 2);
                    return (
                      <details
                        key={i.id}
                        className={cn("group absolute inset-x-1 overflow-visible rounded-md border-l-4 px-2 py-1 text-xs shadow-sm", STATUS_STYLES[i.status])}
                        style={{ top, height }}
                      >
                        <summary className="cursor-pointer list-none leading-tight">
                          <div className="truncate font-semibold">{i.clientName ?? "Walk-in"}</div>
                          <div className="truncate">{i.serviceName}</div>
                          <div className="truncate opacity-70">{formatTime(i.startAt, tz)} – {formatTime(i.endAt, tz)}</div>
                        </summary>
                        <div className="absolute left-0 top-full z-20 mt-1 w-56 rounded-lg border border-stone-200 bg-white p-2 text-stone-800 shadow-lg">
                          {i.notes ? <p className="mb-2 text-xs text-stone-600">{i.notes}</p> : null}
                          <form action={updateAppointmentStatus} className="flex flex-wrap gap-1">
                            <input type="hidden" name="slug" value={slug} />
                            <input type="hidden" name="appointmentId" value={i.appointmentId} />
                            {(["confirmed", "checked_in", "in_progress", "completed", "no_show", "cancelled"] as const)
                              .filter((st) => st !== i.status)
                              .map((st) => (
                                <Button key={st} name="status" value={st} size="sm" variant={st === "cancelled" ? "danger" : "secondary"} type="submit">
                                  {st.replace("_", " ")}
                                </Button>
                              ))}
                          </form>
                        </div>
                      </details>
                    );
                  })}
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  );
}
