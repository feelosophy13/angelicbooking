import Link from "next/link";
import { CalendarCheck, Clock3, DollarSign, UserX, ClipboardList } from "lucide-react";
import { dateShort, time } from "@/lib/format";

type NextUp = { appointmentId: string; startAt: Date; title: string; subtitle: string } | null;

/** Compact numbers for the day shown above the calendar. */
export function TodayStrip({ date, isToday, stats, tz, slug, formsHref, formsFilterOn }: { date: string; isToday: boolean; stats: { appointments: number; unconfirmed: number; completed: number; noShows: number; expected: string | null; nextUp: { appointmentId: string; startAt: Date; clientName: string | null; serviceName: string } | null; formsMissing?: number }; tz: string; slug: string; formsHref?: string; formsFilterOn?: boolean }) {
  if (stats.appointments === 0 && !formsFilterOn) return null;
  const next: NextUp = stats.nextUp ? { appointmentId: stats.nextUp.appointmentId, startAt: stats.nextUp.startAt, title: stats.nextUp.clientName ?? "Walk-in", subtitle: stats.nextUp.serviceName } : null;
  const cells = [
    { icon: CalendarCheck, label: isToday ? "Today" : dateShort(date), value: `${stats.appointments} appointment${stats.appointments === 1 ? "" : "s"}`, sub: stats.unconfirmed ? `${stats.unconfirmed} unconfirmed` : "all confirmed" },
    // Business takings are for people who can see reports; everyone else just sees the day's count and what is next.
    ...(stats.expected !== null ? [{ icon: DollarSign, label: "Expected", value: stats.expected, sub: `${stats.completed} checked out` }] : []),
    ...(stats.noShows ? [{ icon: UserX, label: "No-shows", value: String(stats.noShows), sub: "" }] : []),
    ...(isToday && next ? [{ icon: Clock3, label: "Next up", value: `${time(next.startAt, tz)} · ${next.title}`, sub: next.subtitle, href: `/app/${slug}/appointments/${next.appointmentId}` }] : []),
    ...(stats.formsMissing || formsFilterOn ? [{ icon: ClipboardList, label: "Forms due", value: `${stats.formsMissing ?? 0} visit${stats.formsMissing === 1 ? "" : "s"}`, sub: formsFilterOn ? "showing only these · tap to clear" : "tap to show only these", href: formsHref }] : []),
  ];
  return (
    <div className="mb-4 grid grid-cols-2 gap-2 lg:grid-cols-4 print:hidden">
      {cells.map((c) => {
        const body = (
          <>
            <c.icon className="hidden h-4 w-4 shrink-0 text-stone-400 sm:block" />
            <span className="min-w-0">
              <span className="block text-[11px] uppercase tracking-wide text-stone-500">{c.label}</span>
              <span className="block truncate text-sm font-semibold">{c.value}</span>
              {c.sub ? <span className="block truncate text-xs text-stone-500">{c.sub}</span> : null}
            </span>
          </>
        );
        const cls = "flex items-center gap-3 rounded-xl border border-stone-200 bg-white px-3 py-2";
        return "href" in c && c.href ? <Link key={c.label} href={c.href} className={cls + " hover:bg-stone-50"}>{body}</Link> : <div key={c.label} className={cls}>{body}</div>;
      })}
    </div>
  );
}
