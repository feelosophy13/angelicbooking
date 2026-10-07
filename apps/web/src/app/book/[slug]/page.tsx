import Link from "next/link";
import { instantToISODate } from "@angelic/core";
import { getAvailableDates, getPublicBusiness, getPublicLocations, getPublicMenu, getPublicSlots } from "@/server/public-booking";
import { formatDateLong, formatMoney, formatTime, shiftISODate, cn } from "@/lib/utils";
import { duration } from "@/lib/format";
import { BookingForm, WaitlistForm } from "./forms";

type SP = { service?: string; staff?: string; date?: string; time?: string; month?: string; location?: string };

export default async function PublicBookingPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<SP> }) {
  const { slug } = await params;
  const sp = await searchParams;
  const business = (await getPublicBusiness(slug))!;
  const locations = await getPublicLocations(business.id);
  const location = locations.length > 1 ? (locations.find((l) => l.id === sp.location) ?? null) : (locations[0] ?? null);
  if (locations.length > 1 && !location) {
    return (
      <>
        <Step n={1} title="Choose a location" />
        <ul className="divide-y divide-stone-200 overflow-hidden rounded-xl border border-stone-200 bg-white">
          {locations.map((l) => (
            <li key={l.id}>
              <Link href={`?location=${l.id}`} className="block px-4 py-3 hover:bg-stone-50">
                <p className="font-medium">{l.name}</p>
                <p className="text-xs text-stone-500">{[l.addressLine1, l.city, l.state].filter(Boolean).join(", ")}</p>
              </Link>
            </li>
          ))}
        </ul>
      </>
    );
  }
  const { services, categories, staff } = await getPublicMenu(business.id, locations.length > 1 ? location?.id : null);
  const tz = business.timezone;
  const today = instantToISODate(new Date(), tz);
  const service = services.find((s) => s.id === sp.service) ?? null;
  const staffChoice = sp.staff === "any" || staff.some((s) => s.id === sp.staff) ? sp.staff! : null;
  const date = /^\d{4}-\d{2}-\d{2}$/.test(sp.date ?? "") ? sp.date! : null;
  const q = (extra: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries({ location: locations.length > 1 ? location?.id : undefined, service: service?.id, staff: staffChoice ?? undefined, date: date ?? undefined, ...extra })) if (v) p.set(k, v);
    return `?${p.toString()}`;
  };

  // ---- Step 1: service
  if (!service) {
    const groups = new Map<string, typeof services>();
    for (const s of services) {
      const k = categories.find((c) => c.id === s.categoryId)?.name ?? "Services";
      groups.set(k, [...(groups.get(k) ?? []), s]);
    }
    return (
      <>
        <Step n={1} title="Choose a service" />
        {services.length === 0 ? <p className="text-stone-500">No services are bookable online right now. Please call.</p> : null}
        {[...groups.entries()].map(([cat, list]) => (
          <section key={cat} className="mb-6">
            <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-stone-500">{cat}</h2>
            <ul className="divide-y divide-stone-200 overflow-hidden rounded-xl border border-stone-200 bg-white">
              {list.map((s) => (
                <li key={s.id}>
                  <Link href={q({ service: s.id })} className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-stone-50">
                    <div>
                      <p className="font-medium">{s.name}</p>
                      <p className="text-xs text-stone-500">{duration(s.durationMin + s.gapMin + s.finishMin)}{s.description ? ` · ${s.description}` : ""}</p>
                    </div>
                    <span className="font-medium">{formatMoney(s.priceCents, business.currency)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ))}
        {business.bookingPolicy ? <p className="text-xs text-stone-500">{business.bookingPolicy}</p> : null}
      </>
    );
  }

  const crumb = (
    <p className="mb-4 text-sm text-stone-600">
      <Link href={q({ service: undefined, staff: undefined, date: undefined })} className="underline">{service.name}</Link>
      {staffChoice ? <> · <Link href={q({ staff: undefined, date: undefined })} className="underline">{staffChoice === "any" ? "Any provider" : staff.find((s) => s.id === staffChoice)?.displayName}</Link></> : null}
      {date ? <> · <Link href={q({ date: undefined })} className="underline">{formatDateLong(date)}</Link></> : null}
    </p>
  );

  // ---- Step 2: staff
  if (!staffChoice) {
    return (
      <>
        <Step n={2} title="Choose a provider" />
        {crumb}
        <ul className="divide-y divide-stone-200 overflow-hidden rounded-xl border border-stone-200 bg-white">
          <li><Link href={q({ staff: "any" })} className="block px-4 py-3 font-medium hover:bg-stone-50">Any available provider</Link></li>
          {staff.map((s) => (
            <li key={s.id}><Link href={q({ staff: s.id })} className="flex items-center gap-3 px-4 py-3 hover:bg-stone-50"><span className="h-3 w-3 rounded-full" style={{ background: s.color }} />{s.displayName}</Link></li>
          ))}
        </ul>
      </>
    );
  }

  // ---- Step 3: date + time
  if (!date || !sp.time) {
    const monthStart = /^\d{4}-\d{2}$/.test(sp.month ?? "") ? `${sp.month}-01` : `${today.slice(0, 7)}-01`;
    const daysInMonth = new Date(Date.UTC(Number(monthStart.slice(0, 4)), Number(monthStart.slice(5, 7)), 0)).getUTCDate();
    const firstDow = new Date(monthStart + "T00:00:00Z").getUTCDay();
    const maxDate = shiftISODate(today, business.maxAdvanceDays);
    const available = new Set(await getAvailableDates(business, service.id, staffChoice as "any" | string, monthStart < today ? today : monthStart, daysInMonth));
    const slots = date ? await getPublicSlots(business, service.id, staffChoice as "any" | string, date) : [];
    const prevMonth = shiftISODate(monthStart, -1).slice(0, 7);
    const nextMonth = shiftISODate(monthStart, daysInMonth).slice(0, 7);
    const monthLabel = new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(monthStart + "T00:00:00Z"));
    return (
      <>
        <Step n={3} title="Pick a time" />
        {crumb}
        <div className="grid gap-6 md:grid-cols-[1fr_1fr]">
          <div className="rounded-xl border border-stone-200 bg-white p-4">
            <div className="mb-2 flex items-center justify-between">
              <Link href={q({ month: prevMonth, date: undefined })} className={cn("px-2 text-stone-600", prevMonth < today.slice(0, 7) && "pointer-events-none opacity-30")}>‹</Link>
              <p className="font-medium">{monthLabel}</p>
              <Link href={q({ month: nextMonth, date: undefined })} className={cn("px-2 text-stone-600", `${nextMonth}-01` > maxDate && "pointer-events-none opacity-30")}>›</Link>
            </div>
            <div className="grid grid-cols-7 gap-1 text-center text-xs text-stone-500">{["S", "M", "T", "W", "T", "F", "S"].map((d, i) => <div key={i}>{d}</div>)}</div>
            <div className="mt-1 grid grid-cols-7 gap-1">
              {Array.from({ length: firstDow }).map((_, i) => <div key={`e${i}`} />)}
              {Array.from({ length: daysInMonth }, (_, i) => {
                const d = shiftISODate(monthStart, i);
                const ok = available.has(d) && d <= maxDate;
                return ok ? (
                  <Link key={d} href={q({ date: d, month: sp.month })} className={cn("rounded-lg py-2 text-center text-sm font-medium", d === date ? "text-white" : "")} style={d === date ? { background: "var(--brand)" } : { background: "var(--brand-tint)", color: "var(--brand-dark)" }}>{i + 1}</Link>
                ) : (
                  <div key={d} className="py-2 text-center text-sm text-stone-300">{i + 1}</div>
                );
              })}
            </div>
          </div>
          <div>
            {!date ? <p className="text-sm text-stone-500">Select a highlighted day.</p> : slots.length === 0 ? (
              <div className="space-y-3">
                <p className="text-sm text-stone-600">No openings on {formatDateLong(date)}.</p>
                <WaitlistForm slug={slug} serviceId={service.id} staffId={staffChoice} date={date} />
              </div>
            ) : (
              <>
                <p className="mb-2 text-sm font-medium">{formatDateLong(date)}</p>
                <div className="flex flex-wrap gap-2">
                  {slots.map((s) => (
                    <Link key={s.at.toISOString()} href={q({ date, time: s.at.toISOString(), staff: staffChoice })} className="rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm hover:border-[var(--brand)]" style={{}}>
                      {formatTime(s.at, tz)}{staffChoice === "any" ? <span className="block text-[11px] text-stone-500">{s.staffName}</span> : null}
                    </Link>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
      </>
    );
  }

  // ---- Step 4: details + confirm
  const startAt = new Date(sp.time);
  const slots = await getPublicSlots(business, service.id, staffChoice as "any" | string, date);
  const slot = slots.find((s) => s.at.getTime() === startAt.getTime());
  if (!slot) {
    return (
      <>
        <Step n={4} title="Your details" />
        {crumb}
        <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">That time is no longer available. <Link href={q({ time: undefined })} className="underline">Pick another</Link>.</p>
      </>
    );
  }
  return (
    <>
      <Step n={4} title="Your details" />
      {crumb}
      <div className="mb-4 rounded-xl border p-4 text-sm" style={{ background: "var(--brand-tint)", borderColor: "var(--brand-ring)" }}>
        <p className="font-medium">{service.name} · {formatMoney(service.priceCents, business.currency)}</p>
        <p>{formatDateLong(date)} at {formatTime(startAt, tz)} with {slot.staffName}</p>
        {service.depositCents > 0 ? <p className="mt-1 text-xs text-stone-600">A {formatMoney(service.depositCents, business.currency)} deposit may be required; the salon will confirm.</p> : null}
      </div>
      <BookingForm slug={slug} serviceId={service.id} staffId={slot.staffId} startAt={startAt.toISOString()} policy={business.bookingPolicy} cancelWindowHours={business.cancelWindowHours} />
    </>
  );
}

function Step({ n, title }: { n: number; title: string }) {
  return (
    <div className="mb-4 flex items-center gap-3">
      <span className="flex h-7 w-7 items-center justify-center rounded-full text-sm font-semibold text-white" style={{ background: "var(--brand)" }}>{n}</span>
      <h1 className="text-xl font-semibold">{title}</h1>
    </div>
  );
}
