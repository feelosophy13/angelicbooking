import Link from "next/link";
import { notFound } from "next/navigation";
import { instantToISODate } from "@angelic/core";
import { getManagedAppointment, getPublicSlots } from "@/server/public-booking";
import { formatDateLong, formatTime, shiftISODate } from "@/lib/utils";
import { CancelForm, RescheduleForm } from "./forms";

export default async function ManagePage({ params, searchParams }: { params: Promise<{ slug: string; token: string }>; searchParams: Promise<{ date?: string; moved?: string; cancelled?: string }> }) {
  const { slug, token } = await params;
  const sp = await searchParams;
  const m = await getManagedAppointment(slug, token);
  if (!m || !m.start) notFound();
  const tz = m.business.timezone;
  const day = new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric", timeZone: tz }).format(m.start);
  const status = m.appt.status;
  const first = m.live[0];
  const canReschedule = m.canChange && first?.serviceId && new Set(m.live.map((i) => i.serviceId)).size === 1;
  const date = /^\d{4}-\d{2}-\d{2}$/.test(sp.date ?? "") ? sp.date! : null;
  const slots = canReschedule && date ? await getPublicSlots(m.business, first!.serviceId!, first!.staffId, date) : [];
  const today = instantToISODate(new Date(), tz);

  return (
    <div className="space-y-4">
      {sp.moved ? <p className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">Your appointment has been moved.</p> : null}
      {sp.cancelled ? <p className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">Your appointment has been cancelled.</p> : null}
      <div className="rounded-xl border border-stone-200 bg-white p-5">
        <p className="text-xs uppercase tracking-wide text-stone-500">{status.replace("_", " ")}</p>
        <h1 className="mt-1 text-xl font-semibold">{[...new Set(m.live.map((i) => i.name.replace(" (finish)", "")))].join(", ")}</h1>
        <p className="text-stone-700">{day} at {formatTime(m.start, tz)}</p>
        <p className="text-stone-700">with {[...new Set(m.live.map((i) => i.staffName))].join(" & ")}</p>
        {m.client ? <p className="mt-2 text-sm text-stone-500">Booked for {m.client.firstName} {m.client.lastName}</p> : null}
      </div>

      {status === "cancelled" ? (
        <div className="rounded-xl border border-stone-200 bg-white p-5 text-sm text-stone-600">
          This appointment was cancelled. <Link href={`/book/${slug}`} className="text-brand-700 underline">Book a new one</Link>.
        </div>
      ) : !m.canChange ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-900">
          Online changes close {m.business.cancelWindowHours} hours before your appointment. {m.business.phone ? <>Please call <a className="underline" href={`tel:${m.business.phone}`}>{m.business.phone}</a>.</> : "Please contact the salon."}
        </div>
      ) : (
        <>
          <div className="rounded-xl border border-stone-200 bg-white p-5">
            <h2 className="mb-2 font-medium">Reschedule</h2>
            {!canReschedule ? (
              <p className="text-sm text-stone-600">This booking has several services. Please call to change the time.</p>
            ) : (
              <>
                <form className="mb-3 flex items-end gap-2">
                  <label className="text-sm">
                    <span className="mb-1 block text-stone-600">New date</span>
                    <input type="date" name="date" defaultValue={date ?? shiftISODate(today, 1)} min={today} className="h-10 rounded-lg border border-stone-300 px-3 text-sm" />
                  </label>
                  <button className="h-10 rounded-lg border border-stone-300 bg-white px-3 text-sm">Show times</button>
                </form>
                {date ? (
                  slots.length === 0 ? <p className="text-sm text-stone-500">No openings on {formatDateLong(date)}.</p> : (
                    <RescheduleForm slug={slug} token={token} slots={slots.map((s) => ({ iso: s.at.toISOString(), label: formatTime(s.at, tz) }))} dateLabel={formatDateLong(date)} />
                  )
                ) : null}
              </>
            )}
          </div>
          <div className="rounded-xl border border-stone-200 bg-white p-5">
            <h2 className="mb-2 font-medium">Cancel</h2>
            <CancelForm slug={slug} token={token} />
          </div>
        </>
      )}
      {m.business.bookingPolicy ? <p className="text-xs text-stone-500">{m.business.bookingPolicy}</p> : null}
    </div>
  );
}
