import Link from "next/link";
import { headers } from "next/headers";
import { MapPin } from "lucide-react";
import { instantToISODate, weekdayOf } from "@angelic/core";
import { getAvailableDates, getPublicBusiness, getPublicLocations, getPublicMenu, getPublicSlots, publicProvidersFor } from "@/server/public-booking";
import { buildTree, pathTo, subtreeIds } from "@/server/categories";
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
import { CategoryTile, Crumbs, ServiceCard, Steps, StepTitle, Summary } from "./ui";

type SP = { service?: string; staff?: string; date?: string; time?: string; month?: string; location?: string; session?: string; category?: string };

export default async function PublicBookingPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<SP> }) {
  const { slug } = await params;
  const sp = await searchParams;
  // Rendered under /embed/<slug> inside an iframe on the business's own site: same flow, no chrome.
  const embed = ((await headers()).get("x-pathname") ?? "").startsWith("/embed/");
  const business = (await getPublicBusiness(slug))!;
  const locations = await getPublicLocations(business.id);
  const location = locations.length > 1 ? (locations.find((l) => l.id === sp.location) ?? null) : (locations[0] ?? null);
  const stepLabels = ["Service", "Provider", "Time", "Details"];
  if (locations.length > 1 && !location) {
    return (
      <>
        <Steps labels={["Location", ...stepLabels]} current={1} hrefs={[null, null, null, null, null]} />
        <StepTitle title="Choose a location" subtitle="Where would you like to come in?" />
        <ul className="grid gap-3 sm:grid-cols-2">
          {locations.map((l) => (
            <li key={l.id}>
              <Link href={`?location=${l.id}`} className="block rounded-2xl border border-stone-200 bg-white p-4 shadow-sm transition hover:-translate-y-0.5 hover:border-[var(--brand-ring)] hover:shadow-md">
                <p className="font-semibold text-stone-900">{l.name}</p>
                <p className="mt-0.5 flex items-center gap-1 text-xs text-stone-500"><MapPin className="h-3.5 w-3.5" aria-hidden />{[l.addressLine1, l.city, l.state].filter(Boolean).join(", ") || "Address on request"}</p>
                {l.hours ? <p className="mt-1 text-xs text-stone-500">{describeHours(l.hours).join(" · ")}</p> : null}
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
    for (const [k, v] of Object.entries({ location: locations.length > 1 ? location?.id : undefined, category: service?.categoryId ?? sp.category, service: service?.id, staff: staffChoice ?? undefined, date: date ?? undefined, ...extra })) if (v) p.set(k, v);
    return `?${p.toString()}`;
  };
  const stepHrefs = (upTo: number) => [q({ service: undefined, staff: undefined, date: undefined, time: undefined, session: undefined }), q({ staff: undefined, date: undefined, time: undefined }), q({ time: undefined }), null].map((h, i) => (i < upTo ? h : null));
  const serviceMeta = (s: (typeof services)[number]) => duration(s.durationMin + s.gapMin + s.finishMin);

  // ---- Step 1: service, browsed by category (Hair › Colour › Balayage)
  if (!service) {
    const liveCats = categories.filter((c) => subtreeIds(categories, c.id).some((id) => services.some((s) => s.categoryId === id)));
    const tree = buildTree(liveCats);
    const current = liveCats.find((c) => c.id === sp.category) ?? null;
    const trail = pathTo(liveCats, current?.id);
    const children = current ? (buildTree(liveCats.filter((c) => subtreeIds(liveCats, current.id).includes(c.id)))[0]?.children ?? []) : tree;
    const direct = current ? services.filter((s) => s.categoryId === current.id) : services.filter((s) => !s.categoryId || !liveCats.some((c) => c.id === s.categoryId));
    const countIn = (id: string) => { const ids = subtreeIds(liveCats, id); return services.filter((s) => s.categoryId && ids.includes(s.categoryId)).length; };
    const catMeta = (id: string, subs: number) => { const n = countIn(id); return subs ? `${n} services · ${subs} groups` : `${n} service${n === 1 ? "" : "s"}`; };
    const linkFor = (c: { id: string }) => q({ category: c.id });
    return (
      <>
        <Steps labels={stepLabels} current={1} hrefs={stepHrefs(0)} />
        <StepTitle title={current ? current.name : "What would you like to book?"} subtitle={current?.description ?? (current ? undefined : "Pick a category to see services, prices and times.")} />
        {current ? <Crumbs items={[{ label: "All services", href: q({ category: undefined }) }, ...trail.map((c, i) => ({ label: c.name, href: i === trail.length - 1 ? null : linkFor(c) }))]} /> : null}
        {services.length === 0 ? <p className="rounded-2xl border border-stone-200 bg-white p-6 text-center text-sm text-stone-500">No services are bookable online right now. Please call{business.phone ? ` ${business.phone}` : ""}.</p> : null}
        {children.length ? (
          <div className={cn("grid gap-3 sm:gap-4", children.length === 1 ? "grid-cols-1 sm:grid-cols-2" : "grid-cols-2 sm:grid-cols-3", direct.length && "mb-8")}>
            {children.map((c) => <CategoryTile key={c.id} href={linkFor(c)} name={c.name} imageUrl={c.imageUrl ?? null} description={c.description ?? null} meta={catMeta(c.id, c.children.length)} />)}
          </div>
        ) : null}
        {direct.length ? (
          <section>
            {children.length ? <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-stone-500">{current ? `More in ${current.name}` : "More services"}</h2> : null}
            <ul className="space-y-3">
              {direct.map((s) => <ServiceCard key={s.id} href={q({ service: s.id, category: current?.id })} name={s.name} imageUrl={s.imageUrl} description={s.description} durationLabel={serviceMeta(s)} price={formatMoney(s.priceCents, business.currency)} from={s.capacity > 1 ? "class" : undefined} />)}
            </ul>
          </section>
        ) : null}
        {business.bookingPolicy ? <p className="mt-6 text-xs text-stone-500">{business.bookingPolicy}</p> : null}
      </>
    );
  }

  const providerName = staffChoice === "any" ? "Any available provider" : staff.find((s) => s.id === staffChoice)?.displayName;
  const summaryRows = (extra: { label: string; value: string; href?: string }[] = []) => [
    { label: "Duration", value: serviceMeta(service) },
    ...(staffChoice ? [{ label: "With", value: providerName ?? "", href: q({ staff: undefined, date: undefined, time: undefined }) }] : []),
    ...extra,
  ];

  // ---- Classes: pick a scheduled session instead of a provider + time
  if (service.capacity > 1) {
    const sessions = await publicSessions(business, service.id);
    const chosen = sessions.find((x) => x.id === sp.session) ?? null;
    const classLabels = ["Service", "Class", "Details"];
    if (!chosen) {
      const byDate = new Map<string, typeof sessions>();
      for (const x of sessions) {
        const k = instantToISODate(x.startAt, tz);
        byDate.set(k, [...(byDate.get(k) ?? []), x]);
      }
      return (
        <>
          <Steps labels={classLabels} current={2} hrefs={[q({ service: undefined }), null, null]} />
          <StepTitle title="Pick a class" />
          <Summary imageUrl={service.imageUrl} title={service.name} rows={[{ label: "Per person", value: formatMoney(service.priceCents, business.currency) }, { label: "Duration", value: serviceMeta(service), href: q({ service: undefined }) }]} />
          {sessions.length === 0 ? <p className="rounded-2xl border border-stone-200 bg-white p-6 text-center text-sm text-stone-600">No upcoming sessions are open for booking. Please check back soon{business.phone ? ` or call ${business.phone}` : ""}.</p> : null}
          {[...byDate.entries()].map(([d, list]) => (
            <section key={d} className="mb-4">
              <h2 className="mb-2 text-sm font-semibold text-stone-700">{formatDateLong(d)}</h2>
              <ul className="space-y-2">
                {list.map((x) => (
                  <li key={x.id}>
                    <Link href={q({ session: x.id })} className="flex items-center justify-between gap-3 rounded-2xl border border-stone-200 bg-white px-4 py-3 shadow-sm transition hover:border-[var(--brand-ring)] hover:shadow-md">
                      <div>
                        <p className="font-semibold text-stone-900">{formatTime(x.startAt, tz)} – {formatTime(x.endAt, tz)}</p>
                        <p className="text-xs text-stone-500">with {x.staffName}{x.notes ? ` · ${x.notes}` : ""}</p>
                      </div>
                      <span className="rounded-full px-2.5 py-1 text-xs font-medium" style={{ background: "var(--brand-tint)", color: "var(--brand-dark)" }}>{x.seatsLeft} {x.seatsLeft === 1 ? "seat" : "seats"} left</span>
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
        <Steps labels={classLabels} current={3} hrefs={[q({ service: undefined, session: undefined }), q({ session: undefined }), null]} />
        <StepTitle title="Your details" />
        <Summary imageUrl={service.imageUrl} title={service.name} rows={[{ label: "When", value: `${formatDateLong(sessionDate)} at ${formatTime(chosen.startAt, tz)}`, href: q({ session: undefined }) }, { label: "With", value: chosen.staffName }, { label: "Per person", value: formatMoney(service.priceCents, business.currency) }, { label: "Seats left", value: String(chosen.seatsLeft) }]} />
        {req.mode === "deposit" ? <p className="mb-3 text-xs text-stone-600">A {formatMoney(req.amountCents, business.currency)} deposit is due now and comes off your bill.</p> : req.mode === "card" ? <p className="mb-3 text-xs text-stone-600">A card is needed to hold your seat. Nothing is charged now.</p> : null}
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
        <Steps labels={stepLabels} current={2} hrefs={stepHrefs(1)} />
        <StepTitle title="Choose a provider" />
        <Summary imageUrl={service.imageUrl} title={service.name} rows={[{ label: "Price", value: formatMoney(service.priceCents, business.currency) }, { label: "Duration", value: serviceMeta(service), href: q({ service: undefined }) }]} />
        <ul className="grid gap-3 sm:grid-cols-2">
          <li>
            <Link href={q({ staff: "any" })} className="flex items-center gap-3 rounded-2xl border-2 border-dashed border-stone-300 bg-white p-4 transition hover:border-[var(--brand)] hover:shadow-md">
              <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full text-lg font-semibold text-white" style={{ background: "var(--brand)" }}>✦</span>
              <span><span className="block font-semibold text-stone-900">Any available provider</span><span className="block text-xs text-stone-500">Shows the most openings</span></span>
            </Link>
          </li>
          {providers.map((s) => (
            <li key={s.id}>
              <Link href={q({ staff: s.id })} className="flex items-center gap-3 rounded-2xl border border-stone-200 bg-white p-4 shadow-sm transition hover:border-[var(--brand-ring)] hover:shadow-md">
                {s.photoUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={s.photoUrl} alt="" className="h-14 w-14 shrink-0 rounded-full border border-stone-200 object-cover" />
                ) : (
                  <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full text-lg font-semibold text-white" style={{ background: s.color }}>{s.displayName.slice(0, 1)}</span>
                )}
                <span className="min-w-0">
                  <span className="block font-semibold text-stone-900">{s.displayName}</span>
                  {s.bio ? <span className="line-clamp-2 block text-xs text-stone-500">{s.bio}</span> : null}
                </span>
              </Link>
            </li>
          ))}
        </ul>
        {providers.length === 0 ? <p className="mt-3 text-sm text-stone-500">No one is set up to take this service online yet. Please call{business.phone ? ` ${business.phone}` : ""}.</p> : null}
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
    const byPeriod = (list: typeof slots) => {
      const groups: { label: string; list: typeof slots }[] = [{ label: "Morning", list: [] }, { label: "Afternoon", list: [] }, { label: "Evening", list: [] }];
      for (const s of list) {
        const h = Number(new Intl.DateTimeFormat("en-US", { hour: "numeric", hour12: false, timeZone: tz }).format(s.at));
        groups[h < 12 ? 0 : h < 17 ? 1 : 2]!.list.push(s);
      }
      return groups.filter((g) => g.list.length);
    };
    return (
      <>
        <Steps labels={stepLabels} current={3} hrefs={stepHrefs(2)} />
        <StepTitle title="Pick a time" />
        <Summary imageUrl={service.imageUrl} title={service.name} rows={summaryRows([{ label: "Price", value: formatMoney(service.priceCents, business.currency) }])} />
        <div className="grid gap-5 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <div className="rounded-2xl border border-stone-200 bg-white p-4 shadow-sm">
            <div className="mb-3 flex items-center justify-between">
              <Link href={q({ month: prevMonth, date: undefined })} aria-label="Previous month" className={cn("flex h-8 w-8 items-center justify-center rounded-full text-stone-600 hover:bg-stone-100", prevMonth < today.slice(0, 7) && "pointer-events-none opacity-30")}>‹</Link>
              <p className="font-semibold text-stone-900">{monthLabel}</p>
              <Link href={q({ month: nextMonth, date: undefined })} aria-label="Next month" className={cn("flex h-8 w-8 items-center justify-center rounded-full text-stone-600 hover:bg-stone-100", `${nextMonth}-01` > maxDate && "pointer-events-none opacity-30")}>›</Link>
            </div>
            <div className="grid grid-cols-7 gap-1 text-center text-[11px] font-medium uppercase tracking-wide text-stone-400">{["S", "M", "T", "W", "T", "F", "S"].map((d, i) => <div key={i}>{d}</div>)}</div>
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
                    <Link key={d} href={q({ date: d, month: sp.month })} aria-label={`${label}: openings available`} aria-current={d === date ? "date" : undefined} className={cn("rounded-xl py-2 text-center text-sm font-semibold transition", d === date ? "text-white shadow" : "hover:brightness-95")} style={d === date ? { background: "var(--brand)" } : { background: "var(--brand-tint)", color: "var(--brand-dark)" }}>{i + 1}</Link>
                  );
                }
                // A full day can still be tapped to join the waitlist for it.
                if (bookable) {
                  return (
                    <Link key={d} href={q({ date: d, month: sp.month })} aria-label={`${label}: no openings, join the waitlist`} aria-current={d === date ? "date" : undefined} className={cn("rounded-xl border border-dashed py-2 text-center text-sm", d === date ? "border-stone-500 text-stone-800" : "border-stone-200 text-stone-400 hover:border-stone-400")}>{i + 1}</Link>
                  );
                }
                return <div key={d} aria-hidden className="py-2 text-center text-sm text-stone-300">{i + 1}</div>;
              })}
            </div>
            <p className="mt-3 text-[11px] text-stone-500">Highlighted days have openings. Tap a full day to join its waitlist.</p>
          </div>
          <div>
            {!date ? (
              <div className="flex h-full min-h-32 items-center justify-center rounded-2xl border border-dashed border-stone-300 p-6 text-center text-sm text-stone-500">Choose a day to see times.</div>
            ) : slots.length === 0 ? (
              <div className="space-y-3">
                <p className="text-sm text-stone-600">No openings on {formatDateLong(date)}.</p>
                <WaitlistForm slug={slug} serviceId={service.id} staffId={staffChoice} date={date} locationId={locId} />
              </div>
            ) : (
              <div className="space-y-4">
                <p className="text-sm font-semibold text-stone-900">{formatDateLong(date)}</p>
                {byPeriod(slots).map((g) => (
                  <div key={g.label}>
                    <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-stone-400">{g.label}</p>
                    <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-3">
                      {g.list.map((s) => (
                        <Link key={s.at.toISOString()} href={q({ date, time: s.at.toISOString(), staff: staffChoice })} className="rounded-xl border border-stone-200 bg-white px-2 py-2 text-center text-sm font-medium text-stone-800 shadow-sm transition hover:border-[var(--brand)] hover:text-[var(--brand-dark)]">
                          {formatTime(s.at, tz)}{staffChoice === "any" ? <span className="block truncate text-[10px] font-normal text-stone-500">{s.staffName}</span> : null}
                        </Link>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
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
        <Steps labels={stepLabels} current={4} hrefs={stepHrefs(3)} />
        <StepTitle title="Your details" />
        <p className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">That time is no longer available. <Link href={q({ time: undefined })} className="font-medium underline">Pick another</Link>.</p>
      </>
    );
  }
  const req = onlinePaymentRequirement(business, service, pay);
  return (
    <>
      <Steps labels={stepLabels} current={4} hrefs={stepHrefs(3)} />
      <StepTitle title="Your details" subtitle="Almost done. Tell us who you are and we'll hold this time." />
      <Summary imageUrl={service.imageUrl} title={service.name} rows={[{ label: "When", value: `${formatDateLong(date)} at ${formatTime(startAt, tz)}`, href: q({ time: undefined }) }, { label: "With", value: slot.staffName, href: q({ staff: undefined, date: undefined, time: undefined }) }, { label: "Duration", value: serviceMeta(service) }, { label: "Price", value: formatMoney(service.priceCents, business.currency) }]} />
      {req.mode === "deposit" ? <p className="mb-3 text-xs text-stone-600">A {formatMoney(req.amountCents, business.currency)} deposit is due now and comes off your bill.</p> : req.mode === "card" ? <p className="mb-3 text-xs text-stone-600">A card is needed to hold this booking. Nothing is charged now.</p> : service.depositCents > 0 ? <p className="mb-3 text-xs text-stone-600">A {formatMoney(service.depositCents, business.currency)} deposit may be required; the salon will confirm.</p> : null}
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
