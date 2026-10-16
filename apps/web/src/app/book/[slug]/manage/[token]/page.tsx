import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { instantToISODate, lateCancelFeeLabel, weekdayOf } from "@angelic/core";
import { getAvailableDates, getManagedAppointment, getPublicSlots, publicProvidersFor } from "@/server/public-booking";
import { formatDateLong, formatMoney, formatTime, shiftISODate, cn } from "@/lib/utils";
import { listCancellationReasons } from "@/server/cancellation-reasons";
import { CancelForm, RescheduleForm } from "./forms";
import { MonthCalendar } from "../../calendar";

export const metadata: Metadata = { robots: { index: false, follow: false } };

export default async function ManagePage({ params, searchParams }: { params: Promise<{ slug: string; token: string }>; searchParams: Promise<{ date?: string; month?: string; staff?: string; moved?: string; cancelled?: string; refund?: string }> }) {
  const { slug, token } = await params;
  const sp = await searchParams;
  const m = await getManagedAppointment(slug, token);
  if (!m || !m.start) notFound();
  const tz = m.timeZone;
  const day = new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric", timeZone: tz }).format(m.start);
  const status = m.appt.status;
  const first = m.live[0];
  // A booking whose services are all cancelled has no live first service; nothing below needs one then (rescheduling is off).
  const firstStaff = first?.staffId ?? "";
  const service = first?.serviceId ?? null;
  const single = new Set(m.live.map((i) => i.serviceId)).size === 1;
  const canReschedule = m.canChange && !!service && !m.live.some((i) => i.classSessionId);
  const today = instantToISODate(new Date(), tz);
  const locId = m.appt.locationId;
  // One service can change provider; a multi-service booking moves as a whole with the same people.
  const providers = canReschedule && single ? await publicProvidersFor(m.business, service!, locId) : [];
  const staffChoice = single && (sp.staff === "any" || providers.some((s) => s.id === sp.staff)) ? sp.staff! : firstStaff;
  const date = /^\d{4}-\d{2}-\d{2}$/.test(sp.date ?? "") ? sp.date! : null;
  const apptDay = instantToISODate(m.start, tz);
  const monthStart = /^\d{4}-\d{2}$/.test(sp.month ?? "") ? `${sp.month}-01` : `${(date ?? (apptDay > today && `${apptDay.slice(0, 7)}-01` <= shiftISODate(today, m.business.maxAdvanceDays) ? apptDay : today)).slice(0, 7)}-01`;
  const daysInMonth = new Date(Date.UTC(Number(monthStart.slice(0, 4)), Number(monthStart.slice(5, 7)), 0)).getUTCDate();
  const maxDate = shiftISODate(today, m.business.maxAdvanceDays);
  const rangeStart = monthStart < today ? today : monthStart;
  const monthEnd = shiftISODate(monthStart, daysInMonth - 1);
  const rangeEnd = monthEnd < maxDate ? monthEnd : maxDate;
  const rangeDays = rangeEnd < rangeStart ? 0 : Math.round((Date.parse(`${rangeEnd}T00:00:00Z`) - Date.parse(`${rangeStart}T00:00:00Z`)) / 86_400_000) + 1;
  const available = canReschedule ? new Set(await getAvailableDates(m.business, service!, staffChoice, rangeStart, rangeDays, locId)) : new Set<string>();
  const slots = canReschedule && date ? await getPublicSlots(m.business, service!, staffChoice, date, new Date(), locId) : [];
  const qs = (extra: Record<string, string | undefined>) => {
    const u = new URLSearchParams();
    for (const [k, v] of Object.entries({ staff: staffChoice !== firstStaff ? staffChoice : undefined, month: sp.month, date: date ?? undefined, ...extra })) if (v) u.set(k, v);
    return `?${u.toString()}`;
  };
  const money = (c: number) => formatMoney(c, m.business.currency);
  const lateFee = lateCancelFeeLabel({ feeType: m.business.lateCancelFeeType as "none" | "flat" | "percent", feeValue: m.business.lateCancelFeeValue, deposit: m.business.lateCancelDeposit as "toward" | "extra" }, money);
  const deadline = new Date(m.start.getTime() - m.business.cancelWindowHours * 3_600_000);
  const deadlineText = `${new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: tz }).format(deadline)} at ${formatTime(deadline, tz)}`;
  const depositPaid = m.appt.depositStatus === "paid";

  return (
    <div className="space-y-4">
      {sp.moved ? <p className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">Your appointment has been moved.</p> : null}
      {sp.cancelled ? <p className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">Your appointment has been cancelled.{sp.refund === "pending" ? " Your deposit couldn't be refunded automatically; the salon has been told and will refund it." : ""}</p> : null}
      <div className="rounded-xl border border-stone-200 bg-white p-5">
        <p className="text-xs uppercase tracking-wide text-stone-500">{status.replace("_", " ")}</p>
        <h1 className="mt-1 text-xl font-semibold">{[...new Set(m.live.map((i) => i.name.replace(" (finish)", "")))].join(", ")}</h1>
        <p className="text-stone-700">{day} at {formatTime(m.start, tz)}</p>
        <p className="text-stone-700">with {[...new Set(m.live.map((i) => i.staffName))].join(" & ")}</p>
        {m.client ? <p className="mt-2 text-sm text-stone-500">Booked for {m.client.firstName} {m.client.lastName}</p> : null}
        {m.appt.depositStatus === "paid" ? <p className="mt-1 text-sm text-stone-500">Deposit of {formatMoney(m.appt.depositCents, m.business.currency)} paid. It comes off your bill, and is {m.business.depositRefundAs === "store_credit" ? "returned as store credit" : "refunded"} if you cancel online more than {m.business.cancelWindowHours} hours ahead.</p> : m.appt.depositStatus === "refunded" ? <p className="mt-1 text-sm text-stone-500">Your deposit of {formatMoney(m.appt.depositCents, m.business.currency)} has been {m.business.depositRefundAs === "store_credit" ? "returned as store credit for your next visit" : "refunded"}.</p> : null}
      </div>

      {status === "cancelled" ? (
        <div className="rounded-xl border border-stone-200 bg-white p-5 text-sm text-stone-600">
          This appointment was cancelled. <Link href={`/book/${slug}`} className="text-brand-700 underline">Book a new one</Link>.
        </div>
      ) : !m.canChange ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-900">
          Online changes closed {m.business.cancelWindowHours} hours before your appointment.{lateFee ? ` Cancelling now carries a fee of ${lateFee}.` : ""} {m.business.phone ? <>Please call <a className="underline" href={`tel:${m.business.phone}`}>{m.business.phone}</a>.</> : "Please contact the salon."}
        </div>
      ) : (
        <>
          <div className="space-y-4 rounded-xl border border-stone-200 bg-white p-5">
            <div>
              <h2 className="font-medium">Reschedule</h2>
              <p className="text-xs text-stone-500">Free to change until {deadlineText}.</p>
            </div>
            {!canReschedule ? (
              <p className="text-sm text-stone-600">{m.live.some((i) => i.classSessionId) ? "A class seat moves with the class. Cancel this seat and book another session." : `Please call${m.business.phone ? ` ${m.business.phone}` : ""} to change the time.`}</p>
            ) : (
              <>
                {providers.length > 1 ? (
                  <div className="flex flex-wrap gap-2" role="group" aria-label="Provider">
                    {[...providers.map((s) => ({ id: s.id, name: s.id === firstStaff ? `${s.displayName} (current)` : s.displayName })), { id: "any", name: "Any available" }].map((o) => (
                      <Link key={o.id} href={qs({ staff: o.id === firstStaff ? undefined : o.id, date: undefined })} scroll={false} aria-current={o.id === staffChoice ? "true" : undefined} className={cn("rounded-full border px-3 py-1 text-sm", o.id === staffChoice ? "border-stone-800 bg-stone-800 text-white" : "border-stone-300 bg-white hover:bg-stone-50")}>{o.name}</Link>
                    ))}
                  </div>
                ) : null}
                {!single ? <p className="text-xs text-stone-500">All {m.live.length} services move together, keeping the same order and providers.</p> : null}
                <div className="grid gap-4 md:grid-cols-2">
                  <MonthCalendar
                    monthStart={monthStart}
                    today={today}
                    maxDate={maxDate}
                    available={available}
                    selected={date}
                    isClosed={(d) => (m.location?.hours ? m.location.hours[String(weekdayOf(d))] === null : false)}
                    dayHref={(d) => `${qs({ date: d })}#times`}
                    monthHref={(ym) => qs({ month: ym, date: undefined })}
                  />
                  <div id="times" className="scroll-mt-4">
                    {!date ? (
                      <div className="flex h-full min-h-32 items-center justify-center rounded-2xl border border-dashed border-stone-300 p-6 text-center text-sm text-stone-500">Choose a day to see times.</div>
                    ) : slots.length === 0 ? (
                      <p className="text-sm text-stone-500">No openings on {formatDateLong(date)}. Pick a highlighted day{m.business.phone ? <> or call <a className="underline" href={`tel:${m.business.phone}`}>{m.business.phone}</a></> : null}.</p>
                    ) : (
                      <RescheduleForm slug={slug} token={token} staff={staffChoice !== firstStaff ? staffChoice : undefined} showStaff={staffChoice === "any"} slots={slots.map((s) => ({ iso: s.at.toISOString(), label: formatTime(s.at, tz), staff: s.staffName }))} dateLabel={formatDateLong(date)} />
                    )}
                  </div>
                </div>
              </>
            )}
          </div>
          <div className="rounded-xl border border-stone-200 bg-white p-5">
            <h2 className="mb-1 font-medium">Cancel</h2>
            <p className="mb-3 text-xs text-stone-500">
              Free until {deadlineText}.{depositPaid ? ` Your ${money(m.appt.depositCents)} deposit is ${m.business.depositRefundAs === "store_credit" ? "returned as store credit" : "refunded"} when you cancel in time.` : ""}{lateFee ? ` After that, cancelling carries a fee of ${lateFee}.` : ""}
            </p>
            <CancelForm slug={slug} token={token} reasons={(await listCancellationReasons(m.business.id)).filter((r) => r.clientVisible).map((r) => ({ id: r.id, name: r.name }))} />
          </div>
        </>
      )}
      {m.business.bookingPolicy ? <p className="text-xs text-stone-500">{m.business.bookingPolicy}</p> : null}
    </div>
  );
}
