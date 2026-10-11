import Link from "next/link";
import { headers } from "next/headers";
import { instantToISODate, weekdayOf } from "@angelic/core";
import { getAvailableDates, getPublicBusiness, getPublicLocations, getPublicMenu, getPublicSlots, publicProvidersFor } from "@/server/public-booking";
import { formatDateLong, formatMoney, formatTime, shiftISODate, cn } from "@/lib/utils";
import { duration } from "@/lib/format";
import { BookingForm, WaitlistForm } from "./forms";
import { PaidBookingForm } from "./payment-form";
import { onlinePaymentRequirement } from "@/server/online-payments";
import { paymentContextFor, tzFor } from "@/server/locations";
import { publicSessions } from "@/server/classes";
import { brandHex } from "@/lib/brand";
import { describeHours } from "@/lib/hours";
import { currentClient } from "@/server/client-auth";
import { schema, withTenant } from "@angelic/db";
import { eq } from "drizzle-orm";

type SP = { service?: string; staff?: string; date?: string; time?: string; month?: string; location?: string; session?: string };

export default async function PublicBookingPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<SP> }) {
  const { slug } = await params;
  const sp = await searchParams;
  // Rendered under /embed/<slug> inside an iframe on the business's own site: same flow, no chrome.
  const embed = ((await headers()).get("x-pathname") ?? "").startsWith("/embed/");
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
                {l.hours ? <p className="text-xs text-stone-500">{describeHours(l.hours).join(" · ")}</p> : null}
              </Link>
            </li>
          ))}
        </ul>
      </>
    );
  }
  const { services, categories, staff } = await getPublicMenu(business.id, locations.length > 1 ? location?.id : null);
  // Money for this booking goes to the chosen location's account (deposits, card on file).
  const pay = await paymentContextFor(business, location?.id);
  const locId = locations.length > 1 ? (location?.id ?? null) : null;
  const me = business.clientAccountsEnabled ? await currentClient(business) : null;
  const hasPromos = await withTenant(business.id, async (tx) => !!(await tx.query.promoCodes.findFirst({ where: eq(schema.promoCodes.active, true) })));
  const defaults = me ? { firstName: me.firstName, lastName: me.lastName, phone: me.phone, email: me.email, smsOptIn: me.smsOptIn } : null;
  const tz = tzFor(business, location);
  const today = instantToISODate(new Date(), tz);
  const service = services.find((s) => s.id === sp.service) ?? null;
  // Only providers who perform this service (and are bookable online here) are offered.
  const providerIds = service ? new Set((await publicProvidersFor(business, service.id, locId)).map((s) => s.id)) : null;
  const providers = providerIds ? staff.filter((s) => providerIds.has(s.id)) : staff;
  const staffChoice = sp.staff === "any" || providers.some((s) => s.id === sp.staff) ? sp.staff! : null;
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

  // ---- Classes: pick a scheduled session instead of a provider + time
  if (service.capacity > 1) {
    const sessions = await publicSessions(business, service.id);
    const chosen = sessions.find((x) => x.id === sp.session) ?? null;
    if (!chosen) {
      const byDate = new Map<string, typeof sessions>();
      for (const x of sessions) {
        const k = instantToISODate(x.startAt, tz);
        byDate.set(k, [...(byDate.get(k) ?? []), x]);
      }
      return (
        <>
          <Step n={2} title="Pick a class" />
          {crumb}
          {sessions.length === 0 ? <p className="text-sm text-stone-600">No upcoming sessions are open for booking. Please check back soon{business.phone ? ` or call ${business.phone}` : ""}.</p> : null}
          {[...byDate.entries()].map(([d, list]) => (
            <section key={d} className="mb-4">
              <h2 className="mb-2 text-sm font-semibold text-stone-600">{formatDateLong(d)}</h2>
              <ul className="divide-y divide-stone-200 overflow-hidden rounded-xl border border-stone-200 bg-white">
                {list.map((x) => (
                  <li key={x.id}>
                    <Link href={q({ session: x.id })} className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-stone-50">
                      <div>
                        <p className="font-medium">{formatTime(x.startAt, tz)} – {formatTime(x.endAt, tz)}</p>
                        <p className="text-xs text-stone-500">with {x.staffName}{x.notes ? ` · ${x.notes}` : ""}</p>
                      </div>
                      <span className="text-xs text-stone-600">{x.seatsLeft} {x.seatsLeft === 1 ? "seat" : "seats"} left</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </>
      );
    }
    const req = onlinePaymentRequirement(business, service, pay);
    const sessionDate = instantToISODate(chosen.startAt, tz);
    return (
      <>
        <Step n={3} title="Your details" />
        {crumb}
        <div className="mb-4 rounded-xl border p-4 text-sm" style={{ background: "var(--brand-tint)", borderColor: "var(--brand-ring)" }}>
          <p className="font-medium">{service.name} · {formatMoney(service.priceCents, business.currency)} per person</p>
          <p>{formatDateLong(sessionDate)} at {formatTime(chosen.startAt, tz)} with {chosen.staffName} · {chosen.seatsLeft} {chosen.seatsLeft === 1 ? "seat" : "seats"} left</p>
          {req.mode === "deposit" ? <p className="mt-1 text-xs text-stone-600">A {formatMoney(req.amountCents, business.currency)} deposit is due now and comes off your bill.</p> : req.mode === "card" ? <p className="mt-1 text-xs text-stone-600">A card is needed to hold your seat. Nothing is charged now.</p> : null}
        </div>
        {req.mode === "none" ? (
          <BookingForm slug={slug} serviceId={service.id} staffId={chosen.staffId} startAt={chosen.startAt.toISOString()} policy={business.bookingPolicy} cancelWindowHours={business.cancelWindowHours} classSessionId={chosen.id} referrals={business.loyaltyEnabled} defaults={defaults} promos={hasPromos} embed={embed} locationId={locId} />
        ) : (
          <PaidBookingForm slug={slug} serviceId={service.id} staffId={chosen.staffId} startAt={chosen.startAt.toISOString()} policy={business.bookingPolicy} cancelWindowHours={business.cancelWindowHours} mode={req.mode} amountLabel={formatMoney(req.amountCents, business.currency)} publishableKey={process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY!} brand={brandHex(business.brandColor)} classSessionId={chosen.id} referrals={business.loyaltyEnabled} defaults={defaults} promos={hasPromos} embed={embed} locationId={locId} />
        )}
      </>
    );
  }

  // ---- Step 2: staff
  if (!staffChoice) {
    return (
      <>
        <Step n={2} title="Choose a provider" />
        {crumb}
        <ul className="divide-y divide-stone-200 overflow-hidden rounded-xl border border-stone-200 bg-white">
          <li><Link href={q({ staff: "any" })} className="block px-4 py-3 font-medium hover:bg-stone-50">Any available provider</Link></li>
          {providers.map((s) => (
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
    // Only the part of the month that can be booked is checked for openings.
    const rangeStart = monthStart < today ? today : monthStart;
    const monthEnd = shiftISODate(monthStart, daysInMonth - 1);
    const rangeEnd = monthEnd < maxDate ? monthEnd : maxDate;
    const rangeDays = rangeEnd < rangeStart ? 0 : Math.round((Date.parse(`${rangeEnd}T00:00:00Z`) - Date.parse(`${rangeStart}T00:00:00Z`)) / 86_400_000) + 1;
    const available = new Set(await getAvailableDates(business, service.id, staffChoice as "any" | string, rangeStart, rangeDays, locId));
    const slots = date ? await getPublicSlots(business, service.id, staffChoice as "any" | string, date, new Date(), locId) : [];
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
                // Days the location is closed are neither bookable nor waitlist-able.
                const closed = location?.hours ? location.hours[String(weekdayOf(d))] === null : false;
                const bookable = d >= today && d <= maxDate && !closed;
                const ok = available.has(d) && bookable;
                const label = formatDateLong(d);
                if (ok) {
                  return (
                    <Link key={d} href={q({ date: d, month: sp.month })} aria-label={`${label}: openings available`} aria-current={d === date ? "date" : undefined} className={cn("rounded-lg py-2 text-center text-sm font-medium", d === date ? "text-white" : "")} style={d === date ? { background: "var(--brand)" } : { background: "var(--brand-tint)", color: "var(--brand-dark)" }}>{i + 1}</Link>
                  );
                }
                // A full day can still be tapped to join the waitlist for it.
                if (bookable) {
                  return (
                    <Link key={d} href={q({ date: d, month: sp.month })} aria-label={`${label}: no openings, join the waitlist`} aria-current={d === date ? "date" : undefined} className={cn("rounded-lg border border-dashed py-2 text-center text-sm", d === date ? "border-stone-500 text-stone-800" : "border-stone-200 text-stone-400 hover:border-stone-400")}>{i + 1}</Link>
                  );
                }
                return <div key={d} aria-hidden className="py-2 text-center text-sm text-stone-300">{i + 1}</div>;
              })}
            </div>
            <p className="mt-2 text-xs text-stone-500">Highlighted days have openings. Tap a full day to join its waitlist.</p>
          </div>
          <div>
            {!date ? <p className="text-sm text-stone-500">Select a day.</p> : slots.length === 0 ? (
              <div className="space-y-3">
                <p className="text-sm text-stone-600">No openings on {formatDateLong(date)}.</p>
                <WaitlistForm slug={slug} serviceId={service.id} staffId={staffChoice} date={date} locationId={locId} />
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
  const slots = await getPublicSlots(business, service.id, staffChoice as "any" | string, date, new Date(), locId);
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
  const req = onlinePaymentRequirement(business, service, pay);
  return (
    <>
      <Step n={4} title="Your details" />
      {crumb}
      <div className="mb-4 rounded-xl border p-4 text-sm" style={{ background: "var(--brand-tint)", borderColor: "var(--brand-ring)" }}>
        <p className="font-medium">{service.name} · {formatMoney(service.priceCents, business.currency)}</p>
        <p>{formatDateLong(date)} at {formatTime(startAt, tz)} with {slot.staffName}</p>
        {req.mode === "deposit" ? <p className="mt-1 text-xs text-stone-600">A {formatMoney(req.amountCents, business.currency)} deposit is due now and comes off your bill.</p> : req.mode === "card" ? <p className="mt-1 text-xs text-stone-600">A card is needed to hold this booking. Nothing is charged now.</p> : service.depositCents > 0 ? <p className="mt-1 text-xs text-stone-600">A {formatMoney(service.depositCents, business.currency)} deposit may be required; the salon will confirm.</p> : null}
      </div>
      {req.mode === "none" ? (
        <BookingForm slug={slug} serviceId={service.id} staffId={slot.staffId} startAt={startAt.toISOString()} policy={business.bookingPolicy} cancelWindowHours={business.cancelWindowHours} referrals={business.loyaltyEnabled} defaults={defaults} promos={hasPromos} embed={embed} locationId={locId} />
      ) : (
        <PaidBookingForm
          slug={slug}
          serviceId={service.id}
          staffId={slot.staffId}
          startAt={startAt.toISOString()}
          policy={business.bookingPolicy}
          cancelWindowHours={business.cancelWindowHours}
          mode={req.mode}
          amountLabel={formatMoney(req.amountCents, business.currency)}
          publishableKey={process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY!}
          brand={brandHex(business.brandColor)}
          referrals={business.loyaltyEnabled}
          defaults={defaults}
          promos={hasPromos}
          embed={embed}
          locationId={locId}
        />
      )}
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
