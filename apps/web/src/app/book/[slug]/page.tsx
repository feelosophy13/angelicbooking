import Link from "next/link";
import { headers } from "next/headers";
import { ChevronRight, MapPin } from "lucide-react";
import { instantToISODate, weekdayOf } from "@angelic/core";
import { lateFeeLabelFor } from "@/lib/policy-text";
import { getAvailableDates, getBusinessForLinks, getPublicBusiness, getPublicLocations, getPublicMenu, getPublicSlots, lastProviderFor, nextOpenings, planExtras, providerRatings, timesThatFitVisit, publicProvidersFor, type PlannedExtra } from "@/server/public-booking";
import { BookingError } from "@/server/booking";
import { buildTree, pathTo, subtreeIds } from "@/server/categories";
import { formatDateLong, formatMoney, formatTime, shiftISODate, cn } from "@/lib/utils";
import { duration } from "@/lib/format";
import { BookingForm, WaitlistForm } from "./forms";
import { PaidBookingForm } from "./payment-form";
import { depositLabel, onlinePaymentRequirement } from "@/server/online-payments";
import { cardFeeSettingsOf } from "@angelic/core";
import { cardFeeQuote } from "@/lib/card-fee";
import { paymentContextFor, tzFor } from "@/server/locations";
import { publicSessions } from "@/server/classes";
import { overridesForService, overridesForStaff, priceLabel, servicePriceRanges, termsOf } from "@/server/stylist-pricing";
import { brandHex } from "@/lib/brand";
import { hoursToday } from "@/lib/hours";
import { currentClient } from "@/server/client-auth";
import { schema, withTenant } from "@angelic/db";
import { eq } from "drizzle-orm";
import { CategoryTile, Crumbs, ServiceCard, Stars, StepBack, Steps, StepTitle, Summary } from "./ui";
import { WorkPhotos } from "./work-photos";
import { ServiceSearch } from "./service-search";
import { MonthCalendar } from "./calendar";
import { addonsForService, addonTerms } from "@/server/addons";
import { decodeGuests, encodeGuests, MAX_GUESTS, type GuestChoice } from "@/lib/group-guests";
import { groupPaymentRequirement, planGroup, type GroupPlan } from "@/server/group-booking";
import { linkedClients } from "@/server/client-links";

type SP = { gcat?: string; service?: string; staff?: string; date?: string; time?: string; month?: string; location?: string; session?: string; category?: string; q?: string; extra?: string; add?: string; sort?: string; who?: string; /** Guests booked with the client (lib/group-guests). */ g?: string; /** Adding a guest: "new". */ guest?: string; /** The service picked for the guest being added. */ gsvc?: string };

export default async function PublicBookingPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<SP> }) {
  const { slug } = await params;
  const sp = await searchParams;
  // Rendered under /embed/<slug> inside an iframe on the business's own site: same flow, no chrome.
  const embed = ((await headers()).get("x-pathname") ?? "").startsWith("/embed/");
  const business = await getPublicBusiness(slug);
  if (!business) {
    const b = await getBusinessForLinks(slug);
    return (
      <div className="rounded-xl border border-stone-200 bg-white p-6 text-center text-sm text-stone-700">
        Online booking isn&apos;t available right now.{b?.phone ? <> Call <a href={`tel:${b.phone}`} className="underline">{b.phone}</a> to book.</> : null}
      </div>
    );
  }
  const locations = await getPublicLocations(business.id);
  const location = locations.length > 1 ? (locations.find((l) => l.id === sp.location) ?? null) : (locations[0] ?? null);
  // The salon decides the order: a stylist first (default), or a day and time first and then who is free.
  const timeFirst = business.bookingOrder === "time";
  const stepLabels = timeFirst ? ["Service", "Time", "Provider", "Details"] : ["Service", "Provider", "Time", "Details"];
  if (locations.length > 1 && !location) {
    return (
      <>
        <Steps labels={["Location", ...stepLabels]} current={1} hrefs={[null, null, null, null, null]} />
        <StepTitle title="Choose a location" subtitle="Where would you like to come in?" />
        <ul className="grid gap-3 sm:grid-cols-2">
          {locations.map((l) => {
            const today = hoursToday(l.hours, tzFor(business, l));
            return (
              <li key={l.id}>
                <Link href={`?location=${l.id}`} className="flex h-full items-center gap-3 rounded-2xl border border-stone-200 bg-white p-4 shadow-sm transition hover:border-[var(--brand-ring)] hover:shadow-md">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-stone-100 text-stone-500"><MapPin className="h-5 w-5" aria-hidden /></span>
                  <span className="min-w-0 flex-1">
                    <span className="block font-semibold text-stone-900">{l.name}</span>
                    <span className="mt-0.5 block text-sm text-stone-500">{[l.addressLine1, l.city, l.state].filter(Boolean).join(", ") || "Address on request"}</span>
                    {today ? <span className="mt-1 block text-xs text-stone-500">{today}</span> : null}
                  </span>
                  <ChevronRight className="h-5 w-5 shrink-0 text-stone-300" aria-hidden />
                </Link>
              </li>
            );
          })}
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
  // The late fee is added to the policy line unless the owner's own text already states that same fee.
  const lateFee = lateFeeLabelFor(business);
  // Online bookings ask for a code sent to the phone (or email) unless the client is signed in (Settings → Booking rules).
  const verifyCode = business.verifyBookingContact && !me;
  const defaults = me ? { firstName: me.firstName, lastName: me.lastName, phone: me.phone, email: me.email, smsOptIn: me.smsOptIn, smsMarketingOptIn: me.smsMarketingOptIn } : null;
  const tz = tzFor(business, location);
  const today = instantToISODate(new Date(), tz);
  const service = services.find((s) => s.id === sp.service) ?? null;
  // Only providers who perform this service (and are bookable online here) are offered.
  const providerIds = service ? new Set((await publicProvidersFor(business, service.id, locId)).map((s) => s.id)) : null;
  const providers = providerIds ? staff.filter((s) => providerIds.has(s.id)) : staff;
  const staffChoice = sp.staff === "any" || providers.some((s) => s.id === sp.staff) ? sp.staff! : null;
  const withTitle = (id: string, name: string) => { const t = staff.find((s) => s.id === id)?.position; return t ? `${name} · ${t}` : name; };
  const date = /^\d{4}-\d{2}-\d{2}$/.test(sp.date ?? "") ? sp.date! : null;
  const extraIds = [...new Set((sp.extra ?? "").split(",").filter(Boolean))].slice(0, 4);
  const guests = decodeGuests(sp.g);
  const q = (extra: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    // Choosing a different service starts a new visit, so the added services and guests go with the old one.
    const keepExtras = "service" in extra ? undefined : extraIds.join(",") || undefined;
    const keepGuests = "service" in extra ? undefined : sp.g && guests.length ? encodeGuests(guests) : undefined;
    for (const [k, v] of Object.entries({ location: locations.length > 1 ? location?.id : undefined, category: service?.categoryId ?? sp.category, service: service?.id, staff: staffChoice ?? undefined, date: date ?? undefined, extra: keepExtras, g: keepGuests, time: timeFirst || sp.who === "time" ? sp.time : undefined, ...extra })) if (v) p.set(k, v);
    return `?${p.toString()}`;
  };
  const locBar = locations.length > 1 && location ? (
    <p className="mb-3 flex items-center gap-1.5 text-sm text-stone-600"><MapPin className="h-4 w-4 text-stone-400" aria-hidden />{location.name}<Link href="?" className="text-xs underline" style={{ color: "var(--brand-dark)" }}>Change</Link></p>
  ) : null;
  const stepHrefs = (upTo: number) =>
    (timeFirst
      ? [q({ service: undefined, staff: undefined, date: undefined, time: undefined, session: undefined }), q({ staff: undefined, date: undefined, time: undefined }), q({ staff: undefined }), null]
      : [q({ service: undefined, staff: undefined, date: undefined, time: undefined, session: undefined }), q({ staff: undefined, date: undefined, time: undefined }), q({ time: undefined }), null]
    ).map((h, i) => (i < upTo ? h : null));
  const callUs = business.phone ? <> or call <a href={`tel:${business.phone}`} className="font-medium underline">{business.phone}</a></> : null;
  const money = (c: number) => formatMoney(c, business.currency);
  const depositRow = service && depositLabel(service, money) ? [{ label: "Pay now", value: depositLabel(service, money)!.replace(/ deposit$/, " deposit") }] : [];
  // Prices differ between stylists: the service list says "from" the lowest one.
  const ranges = service ? null : await withTenant(business.id, (tx) => servicePriceRanges(tx, services, staff));
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
    const term = (sp.q ?? "").trim().toLowerCase().slice(0, 80);
    const catName = (id: string | null) => liveCats.find((c) => c.id === id)?.name ?? "";
    const hits = term ? services.filter((s) => `${s.name} ${s.description ?? ""} ${catName(s.categoryId)}`.toLowerCase().includes(term)) : [];
    const card = (s: (typeof services)[number], cat?: string) => <ServiceCard key={s.id} href={q({ service: s.id, category: cat })} name={s.name} imageUrl={s.imageUrl} description={s.description} durationLabel={serviceMeta(s)} price={priceLabel(ranges?.get(s.id) ?? { min: s.priceCents, max: s.priceCents }, money).label} priceFrom={priceLabel(ranges?.get(s.id) ?? { min: s.priceCents, max: s.priceCents }, money).varies} from={s.capacity > 1 ? "class" : undefined} deposit={depositLabel(s, money) ?? undefined} />;
    const search = services.length > 8 ? <ServiceSearch value={sp.q ?? ""} location={locations.length > 1 ? location?.id : undefined} /> : null;
    if (term) {
      return (
        <>
          <StepBack href={q({ category: undefined })} />
          {locBar}
          <Steps labels={stepLabels} current={1} hrefs={stepHrefs(0)} />
          <StepTitle title="What would you like to book?" />
          {search}
          <p className="mb-3 text-sm text-stone-500">{hits.length} result{hits.length === 1 ? "" : "s"} for “{sp.q!.trim()}”. <Link href={q({ category: undefined })} className="underline">Browse all services</Link></p>
          {hits.length === 0 ? <p className="rounded-2xl border border-stone-200 bg-white p-6 text-center text-sm text-stone-500">Nothing matches that. Try a shorter word like “lash” or “wax”{callUs}.</p> : null}
          <ul className="space-y-3">{hits.map((s) => card(s, s.categoryId ?? undefined))}</ul>
        </>
      );
    }
    return (
      <>
        <StepBack href={current ? q({ category: trail.length > 1 ? trail[trail.length - 2]!.id : undefined }) : locations.length > 1 ? "?" : null} />
        {locBar}
        <Steps labels={stepLabels} current={1} hrefs={stepHrefs(0)} />
        <StepTitle title={current ? current.name : "What would you like to book?"} subtitle={current?.description ?? (current ? undefined : "Search, or pick a category to see services, prices and times.")} />
        {search}
        {current ? <Crumbs items={[{ label: "All services", href: q({ category: undefined }) }, ...trail.map((c, i) => ({ label: c.name, href: i === trail.length - 1 ? null : linkFor(c) }))]} /> : null}
        {services.length === 0 ? <p className="rounded-2xl border border-stone-200 bg-white p-6 text-center text-sm text-stone-500">No services are bookable online right now. Please check back{callUs ? null : " soon"}{callUs}.</p> : null}
        {children.length ? (
          <div className={cn("grid gap-3 sm:gap-4", children.length === 1 ? "grid-cols-1 sm:grid-cols-2" : "grid-cols-2 sm:grid-cols-3", direct.length && "mb-8")}>
            {children.map((c) => <CategoryTile key={c.id} href={linkFor(c)} name={c.name} imageUrl={c.imageUrl ?? null} description={c.description ?? null} meta={catMeta(c.id, c.children.length)} />)}
          </div>
        ) : null}
        {direct.length ? (
          <section>
            {children.length ? <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-stone-500">{current ? `More in ${current.name}` : "More services"}</h2> : null}
            <ul className="space-y-3">
              {direct.map((s) => card(s, current?.id))}
            </ul>
          </section>
        ) : null}
        {business.bookingPolicy ? <p className="mt-6 text-xs text-stone-500">{business.bookingPolicy}</p> : null}
      </>
    );
  }

  // Each stylist's own price and length for this service; the page quotes the one who will do it.
  const overrides = await withTenant(business.id, (tx) => overridesForService(tx, service.id));
  const termsFor = (staffId: string) => termsOf(service, overrides.get(staffId));
  const provTerms = providers.map((p) => ({ id: p.id, ...termsFor(p.id) }));
  const priceVaries = new Set(provTerms.map((t) => t.priceCents)).size > 1;
  const lowestPrice = provTerms.length ? Math.min(...provTerms.map((t) => t.priceCents)) : service.priceCents;
  // Said out loud when the chosen provider costs more than the "from" price the client saw earlier.
  const pricierNote = (staffId: string, fallbackName: string) => {
    const cents = termsFor(staffId).priceCents;
    const who = staff.find((s) => s.id === staffId);
    const label = `${who?.displayName ?? fallbackName}${who?.position ? ` (${who.position})` : ""}`;
    return priceVaries && cents > lowestPrice ? <p className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">{label} charges {money(cents)} for this service, higher than the {money(lowestPrice)} starting price.</p> : null;
  };

  const durationVaries = new Set(provTerms.map((t) => t.durationMin)).size > 1;
  const scope = staffChoice && staffChoice !== "any" ? provTerms.filter((t) => t.id === staffChoice) : provTerms;
  const scopePrices = scope.length ? scope.map((t) => t.priceCents) : [service.priceCents];
  const scopeMins = scope.length ? scope.map((t) => t.durationMin) : [service.durationMin];
  // Said before a time is chosen: what is taken up front and what changing the booking costs.
  const holdReq = onlinePaymentRequirement(business, service, pay, lowestPrice);
  const holdNote = holdReq.mode === "deposit" ? (holdReq.full ? "Payment in full is taken when you book. It holds your time." : "A deposit is taken when you book. It holds your time and comes off your bill on the day.") : holdReq.mode === "card" ? "A card is needed to hold your time. Nothing is charged now." : depositLabel(service, money) ? "This service takes a deposit to hold your time. The salon will contact you to arrange it." : null;
  const bookingNotes = (
    <div className="mb-4 space-y-1 text-xs text-stone-600">
      {holdNote ? <p>{holdNote}</p> : null}
      <p>Free to change or cancel up to {business.cancelWindowHours} hours before.{lateFee ? ` After that, cancelling carries a fee of ${lateFee}.` : ""}</p>
    </div>
  );
  const fromIf = (min: number, max: number, text: string) => (min === max ? text : `from ${text}`);
  const priceText = fromIf(Math.min(...scopePrices), Math.max(...scopePrices), money(Math.min(...scopePrices)));
  const spanOf = (mins: number) => duration(mins + service.gapMin + service.finishMin);
  const durationText = fromIf(Math.min(...scopeMins), Math.max(...scopeMins), spanOf(Math.min(...scopeMins)));
  const providerName = staffChoice === "any" ? "Any available provider" : staffChoice ? withTitle(staffChoice, staff.find((s) => s.id === staffChoice)?.displayName ?? "") : undefined;
  const summaryRows = (extra: { label: string; value: string; href?: string }[] = []) => [
    { label: "Duration", value: durationText },
    ...(staffChoice ? [{ label: "With", value: providerName ?? "", href: timeFirst ? q({ staff: undefined }) : q({ staff: undefined, date: undefined, time: undefined }) }] : []),
    ...extra,
  ];

  /** The slots at which this visit and every guest fit (checked in order, at most 48). */
  async function groupFits<T>(list: T[], at: (s: T) => { staffId: string; startAt: Date }): Promise<T[]> {
    const out: T[] = [];
    for (const s of list.slice(0, 48)) {
      const fits = await planGroup(business!, { serviceId: service!.id, ...at(s), extraServiceIds: extraIds, locationId: locId, guests }).then(() => true, (e) => { if (e instanceof BookingError) return false; throw e; });
      if (fits) out.push(s);
    }
    return out;
  }

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
          <StepBack href={q({ service: undefined })} />
          {locBar}
          <Steps labels={classLabels} current={2} hrefs={[q({ service: undefined }), null, null]} />
          <StepTitle title="Pick a class" />
          <Summary imageUrl={service.imageUrl} title={service.name} rows={[{ label: "Per person", value: formatMoney(service.priceCents, business.currency) }, { label: "Duration", value: serviceMeta(service), href: q({ service: undefined }) }]} />
          {service.description ? <p className="mb-4 text-sm text-stone-600">{service.description}</p> : null}
          {bookingNotes}
          {sessions.length === 0 ? <p className="rounded-2xl border border-stone-200 bg-white p-6 text-center text-sm text-stone-600">No upcoming sessions are open for booking. Please check back soon{callUs}.</p> : null}
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
                      <span className="flex shrink-0 flex-col items-end gap-1"><span className="font-semibold text-stone-900">{formatMoney(service.priceCents, business.currency)}</span><span className="rounded-full px-2.5 py-1 text-xs font-medium" style={{ background: "var(--brand-tint)", color: "var(--brand-dark)" }}>{x.seatsLeft} {x.seatsLeft === 1 ? "seat" : "seats"} left</span></span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </>
      );
    }
    const req = onlinePaymentRequirement(business, service, pay, service.priceCents);
    const sessionDate = instantToISODate(chosen.startAt, tz);
    return (
      <>
        <StepBack href={q({ session: undefined })} />
        {locBar}
        <Steps labels={classLabels} current={3} hrefs={[q({ service: undefined, session: undefined }), q({ session: undefined }), null]} />
        <StepTitle title="Your details" />
        <Summary imageUrl={service.imageUrl} title={service.name} rows={[{ label: "When", value: `${formatDateLong(sessionDate)} at ${formatTime(chosen.startAt, tz)}`, href: q({ session: undefined }) }, { label: "With", value: chosen.staffName }, { label: "Per person", value: formatMoney(service.priceCents, business.currency) }, { label: "Seats left", value: String(chosen.seatsLeft) }]} />
        {req.mode === "none" ? (
          <BookingForm verify={verifyCode} priceLabel={money(service.priceCents)} slug={slug} serviceId={service.id} staffId={chosen.staffId} startAt={chosen.startAt.toISOString()} policy={business.bookingPolicy} cancelWindowHours={business.cancelWindowHours} lateFee={lateFee} classSessionId={chosen.id} referrals={business.loyaltyEnabled} defaults={defaults} promos={hasPromos} embed={embed} locationId={locId} />
        ) : (
          <PaidBookingForm verify={verifyCode} priceLabel={money(service.priceCents)} slug={slug} serviceId={service.id} staffId={chosen.staffId} startAt={chosen.startAt.toISOString()} policy={business.bookingPolicy} cancelWindowHours={business.cancelWindowHours} lateFee={lateFee} mode={req.mode} full={req.full} amountLabel={formatMoney(req.amountCents, business.currency)} amountCents={req.amountCents} currency={business.currency} cardFee={req.mode === "deposit" ? cardFeeQuote(cardFeeSettingsOf(business), pay.provider, "online", req.amountCents, business.currency, { cashOption: false }) : null} publishableKey={process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY!} brand={brandHex(business.brandColor)} classSessionId={chosen.id} referrals={business.loyaltyEnabled} defaults={defaults} promos={hasPromos} embed={embed} locationId={locId} />
        )}
      </>
    );
  }

  // ---- Step 2: staff
  // Who is free at one chosen time: always in time-first order, and in provider-first order when "Any available" met a time several people share.
  const whoAtTime = timeFirst || (staffChoice === "any" && sp.who === "time");
  const pickTime = whoAtTime && date && sp.time ? new Date(sp.time) : null;
  if (pickTime ? (timeFirst ? !staffChoice : staffChoice === "any") : !staffChoice && !timeFirst) {
    // Time first: only the people who are free at the chosen time.
    const pool = pickTime ? (await Promise.all(providers.map(async (p) => ((await getPublicSlots(business, service.id, p.id, date!, new Date(), locId)).some((s) => s.at.getTime() === pickTime.getTime()) ? p : null)))).filter((p): p is (typeof providers)[number] => !!p) : providers;
    const [ratings, openings, last] = await Promise.all([
      providerRatings(business.id),
      nextOpenings(business, service.id, providers.map((p) => p.id), locId),
      me ? lastProviderFor(business.id, me.id, service.id) : Promise.resolve(null),
    ]);
    const openText = (d: Date | null | undefined) => {
      if (!d) return "No openings in the next 3 weeks";
      const day = instantToISODate(d, tz) === today ? "Today" : new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: tz }).format(d);
      return `Next opening: ${day} at ${formatTime(d, tz)}`;
    };
    const earliest = [...openings.values()].filter((d): d is Date => !!d).sort((a, b) => a.getTime() - b.getTime())[0] ?? null;
    // The salon's own order by default; the client can put the soonest opening or the lowest price first.
    const sortKey = sp.sort === "soonest" || (sp.sort === "price" && priceVaries) ? sp.sort : "recommended";
    const ordered = [...pool];
    // Time first: quote what the people free at that time charge, not the whole team.
    const poolPrices = pool.map((s) => termsFor(s.id).priceCents);
    const shownPrice = pickTime && poolPrices.length ? fromIf(Math.min(...poolPrices), Math.max(...poolPrices), money(Math.min(...poolPrices))) : priceText;
    if (sortKey === "soonest") ordered.sort((a, b) => (openings.get(a.id)?.getTime() ?? Infinity) - (openings.get(b.id)?.getTime() ?? Infinity));
    if (sortKey === "price") ordered.sort((a, b) => termsFor(a.id).priceCents - termsFor(b.id).priceCents);
    const sortOptions = [{ key: "recommended", label: "Recommended" }, { key: "soonest", label: "Soonest" }, ...(priceVaries ? [{ key: "price", label: "Lowest price" }] : [])];
    const lastPerson = last ? pool.find((s) => s.id === last.staffId) ?? null : null;
    return (
      <>
        <StepBack href={pickTime ? q({ time: undefined }) : q({ service: undefined })} />
        {locBar}
        <Steps labels={stepLabels} current={pickTime ? 3 : 2} hrefs={stepHrefs(pickTime ? 2 : 1)} />
        <StepTitle title={pickTime && !timeFirst ? "Who would you like?" : "Choose a provider"} subtitle={pickTime ? `Free ${formatDateLong(date!)} at ${formatTime(pickTime, tz)}` : undefined} />
        <Summary imageUrl={service.imageUrl} title={service.name} rows={[...(pickTime ? [{ label: "When", value: `${formatDateLong(date!)} at ${formatTime(pickTime, tz)}`, href: q({ time: undefined }) }] : []), { label: "Price", value: shownPrice }, ...depositRow, { label: "Duration", value: durationText, href: q({ service: undefined }) }]} />
        {bookingNotes}
        {lastPerson ? (
          <Link href={q({ staff: lastPerson.id })} className="mb-3 flex items-center gap-3 rounded-2xl border-2 bg-white p-4 shadow-sm transition hover:shadow-md" style={{ borderColor: "var(--brand)" }}>
            {lastPerson.photoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={lastPerson.photoUrl} alt="" className="h-12 w-12 shrink-0 rounded-full border border-stone-200 object-cover" />
            ) : (
              <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full text-lg font-semibold text-white" style={{ background: lastPerson.color }}>{lastPerson.displayName.slice(0, 1)}</span>
            )}
            <span className="min-w-0 flex-1">
              <span className="block font-semibold text-stone-900">Book with {lastPerson.displayName} again</span>
              <span className="block text-xs text-stone-500">You saw {lastPerson.displayName.split(" ")[0]} for this on {new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: tz }).format(last!.at)} · {openText(openings.get(lastPerson.id))}</span>
            </span>
            {priceVaries ? <span className="shrink-0 font-semibold text-stone-900">{money(termsFor(lastPerson.id).priceCents)}</span> : null}
          </Link>
        ) : null}
        {!pickTime && providers.length > 2 ? (
          <div className="mb-3 flex flex-wrap items-center gap-2 text-sm" role="group" aria-label="Sort providers">
            <span className="text-stone-500">Sort:</span>
            {sortOptions.map((o) => (
              <Link key={o.key} href={q({ sort: o.key === "recommended" ? undefined : o.key })} scroll={false} aria-current={o.key === sortKey ? "true" : undefined} className={cn("rounded-full border px-3 py-1", o.key === sortKey ? "border-stone-800 bg-stone-800 text-white" : "border-stone-300 bg-white hover:bg-stone-50")}>{o.label}</Link>
            ))}
          </div>
        ) : null}
        <ul className="grid gap-3 sm:grid-cols-2">
          {pool.length > 1 ? (
            <li>
              <Link href={q({ staff: "any" })} className="flex h-full items-center gap-3 rounded-2xl border-2 border-dashed border-stone-300 bg-white p-4 transition hover:border-[var(--brand)] hover:shadow-md">
                <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full text-lg font-semibold text-white" style={{ background: "var(--brand)" }}>✦</span>
                <span><span className="block font-semibold text-stone-900">Any available provider</span><span className="block text-xs text-stone-500">{pickTime ? "Whoever is free at this time" : "Shows the most openings"}{priceVaries ? ` · ${shownPrice}` : ""}</span>{earliest && !pickTime ? <span className="mt-0.5 block text-xs text-stone-500">{openText(earliest)}</span> : null}</span>
              </Link>
            </li>
          ) : null}
          {ordered.map((s) => {
            const rating = ratings.get(s.id);
            return (
              <li key={s.id} className="rounded-2xl border border-stone-200 bg-white shadow-sm transition hover:border-[var(--brand-ring)] hover:shadow-md">
                <Link href={q({ staff: s.id })} className="flex items-center gap-3 p-4">
                  {s.photoUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={s.photoUrl} alt="" className="h-14 w-14 shrink-0 rounded-full border border-stone-200 object-cover" />
                  ) : (
                    <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full text-lg font-semibold text-white" style={{ background: s.color }}>{s.displayName.slice(0, 1)}</span>
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="block font-semibold text-stone-900">{s.displayName}</span>
                    {s.position ? <span className="block text-xs font-medium" style={{ color: "var(--brand-dark)" }}>{s.position}</span> : null}
                    {rating ? <span className="mt-0.5 flex items-center gap-1 text-xs text-stone-600"><Stars value={rating.average} size="h-3 w-3" />{rating.average.toFixed(1)} <span className="text-stone-400">({rating.count})</span></span> : null}
                    {s.bio ? <span className="line-clamp-2 block text-xs text-stone-500">{s.bio}</span> : null}
                    {!pickTime ? <span className="mt-0.5 block text-xs text-stone-500">{openText(openings.get(s.id))}</span> : null}
                  </span>
                  {priceVaries || durationVaries ? (
                    <span className="shrink-0 text-right">
                      {priceVaries ? <span className="block font-semibold text-stone-900">{money(termsFor(s.id).priceCents)}</span> : null}
                      {durationVaries ? <span className="block text-[11px] text-stone-500">{spanOf(termsFor(s.id).durationMin)}</span> : null}
                    </span>
                  ) : null}
                </Link>
                {s.workPhotoUrls?.length ? <div className="px-4 pb-4"><WorkPhotos urls={s.workPhotoUrls} name={s.displayName} /></div> : null}
              </li>
            );
          })}
        </ul>
        {pickTime && pool.length === 0 ? <p className="mt-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">Nobody is free at that time any more. <Link href={q({ time: undefined })} className="font-medium underline">Pick another time</Link>.</p> : null}
        {providers.length === 0 ? <p className="mt-3 text-sm text-stone-500">No one is set up to take this service online yet. <Link href={q({ service: undefined })} className="font-medium underline">Pick another service</Link>{callUs}.</p> : null}
      </>
    );
  }

  // ---- Step 3: date + time
  if (!date || !sp.time) {
    const availStaff = (staffChoice ?? "any") as "any" | string;
    const monthStart = /^\d{4}-\d{2}$/.test(sp.month ?? "") ? `${sp.month}-01` : `${today.slice(0, 7)}-01`;
    const daysInMonth = new Date(Date.UTC(Number(monthStart.slice(0, 4)), Number(monthStart.slice(5, 7)), 0)).getUTCDate();
    const maxDate = shiftISODate(today, business.maxAdvanceDays);
    // Only the part of the month that can be booked is checked for openings.
    const rangeStart = monthStart < today ? today : monthStart;
    const monthEnd = shiftISODate(monthStart, daysInMonth - 1);
    const rangeEnd = monthEnd < maxDate ? monthEnd : maxDate;
    const rangeDays = rangeEnd < rangeStart ? 0 : Math.round((Date.parse(`${rangeEnd}T00:00:00Z`) - Date.parse(`${rangeStart}T00:00:00Z`)) / 86_400_000) + 1;
    const available = new Set(await getAvailableDates(business, service.id, availStaff, rangeStart, rangeDays, locId));
    const allSlots = date ? await getPublicSlots(business, service.id, availStaff, date, new Date(), locId) : [];
    // With guests, only the times when everyone fits.
    const slots = guests.length ? await groupFits(allSlots, (s) => ({ staffId: s.staffId, startAt: s.at })) : allSlots;
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
        <StepBack href={timeFirst ? q({ service: undefined, staff: undefined, date: undefined, time: undefined }) : q({ staff: undefined, date: undefined, time: undefined })} />
        {locBar}
        <Steps labels={stepLabels} current={timeFirst ? 2 : 3} hrefs={stepHrefs(timeFirst ? 1 : 2)} />
        <StepTitle title="Pick a time" />
        <Summary imageUrl={service.imageUrl} title={service.name} rows={summaryRows([{ label: "Price", value: priceText }, ...depositRow])} />
        {staffChoice && staffChoice !== "any" ? pricierNote(staffChoice, "This provider") : null}
        {bookingNotes}
        <div className="grid gap-5 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <MonthCalendar
            monthStart={monthStart}
            today={today}
            maxDate={maxDate}
            available={available}
            selected={date}
            isClosed={(d) => (location?.hours ? location.hours[String(weekdayOf(d))] === null : false)}
            dayHref={(d) => `${q({ date: d, month: sp.month })}#times`}
            monthHref={(ym) => q({ month: ym, date: undefined })}
            fullDayHint
          />
          <div id="times" className="scroll-mt-4">
            {!date ? (
              <div className="flex h-full min-h-32 items-center justify-center rounded-2xl border border-dashed border-stone-300 p-6 text-center text-sm text-stone-500">Choose a day to see times.</div>
            ) : slots.length === 0 && allSlots.length ? (
              <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">No time on {formatDateLong(date)} fits everyone in your group. Try another day, or <Link href={q({ g: undefined })} className="font-medium underline">remove your guests</Link>.</div>
            ) : slots.length === 0 ? (
              <div className="space-y-3">
                <p className="text-sm text-stone-600">No openings on {formatDateLong(date)}.</p>
                <WaitlistForm slug={slug} serviceId={service.id} staffId={availStaff} date={date} locationId={locId} defaults={defaults} />
              </div>
            ) : (
              <div className="space-y-4">
                <p className="text-sm font-semibold text-stone-900">{formatDateLong(date)}</p>
                {guests.length ? <p className="text-xs text-stone-500">Times when you and your {guests.length === 1 ? "guest both fit" : `${guests.length} guests all fit`}.</p> : null}
                {byPeriod(slots).map((g) => (
                  <div key={g.label}>
                    <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-stone-400">{g.label}</p>
                    <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-3">
                      {g.list.map((s) => (
                        <Link key={s.at.toISOString()} href={staffChoice === "any" && business.anyProviderMode === "choose" && s.free.length > 1 ? q({ date, time: s.at.toISOString(), who: "time" }) : q({ date, time: s.at.toISOString(), staff: timeFirst && !staffChoice ? undefined : (staffChoice ?? undefined) })} className="rounded-xl border border-stone-200 bg-white px-2 py-2 text-center text-sm font-medium text-stone-800 shadow-sm transition hover:border-[var(--brand)] hover:text-[var(--brand-dark)]">
                          {formatTime(s.at, tz)}{staffChoice === "any" ? (business.anyProviderMode === "choose" && s.free.length > 1 ? <><span className="block truncate text-[10px] font-normal text-stone-500">{s.free.length} available</span>{priceVaries ? <span className="block text-[10px] font-medium text-stone-700">{fromIf(Math.min(...s.free.map((id) => termsFor(id).priceCents)), Math.max(...s.free.map((id) => termsFor(id).priceCents)), money(Math.min(...s.free.map((id) => termsFor(id).priceCents))))}</span> : null}</> : <><span className="block truncate text-[10px] font-normal text-stone-500">{s.staffName}</span>{priceVaries ? <span className="block text-[10px] font-medium text-stone-700">{money(termsFor(s.staffId).priceCents)}</span> : null}</>) : null}
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
        <StepBack href={q({ time: sp.time })} />
        {locBar}
        <Steps labels={stepLabels} current={4} hrefs={stepHrefs(3)} />
        <StepTitle title="Your details" />
        <p className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">That time was just taken or is no longer open. <Link href={q({ time: undefined })} className="font-medium underline">Pick another time</Link>.</p>
      </>
    );
  }
  // ---- Add another service to this visit: same provider, straight after the first
  const taken = new Set([service.id, ...extraIds]);
  const [mapRows, mine] = await withTenant(business.id, async (tx) => [await tx.select({ serviceId: schema.staffServices.serviceId, staffId: schema.staffServices.staffId }).from(schema.staffServices), await overridesForStaff(tx, slot.staffId)] as const);
  const restricted = new Set(mapRows.map((r) => r.serviceId));
  const performs = new Set(mapRows.filter((r) => r.staffId === slot.staffId).map((r) => r.serviceId));
  const options = extraIds.length < 4 ? services.filter((s) => !taken.has(s.id) && s.capacity === 1 && (!restricted.has(s.id) || performs.has(s.id))) : [];
  if (sp.add) {
    const who = staff.find((s) => s.id === slot.staffId)?.displayName ?? slot.staffName;
    return (
      <>
        <StepBack href={timeFirst ? q({ staff: undefined }) : q({ time: undefined })} />
        {locBar}
        <Steps labels={stepLabels} current={4} hrefs={stepHrefs(3)} />
        <StepTitle title="Add another service" subtitle={`With ${who}, right after ${service.name}. Pick one and we'll check ${who.split(" ")[0]} is free then.`} />
        <p className="mb-3 text-sm"><Link href={q({ time: sp.time })} className="underline" style={{ color: "var(--brand-dark)" }}>Never mind, back to my details</Link></p>
        {options.length === 0 ? <p className="rounded-2xl border border-stone-200 bg-white p-6 text-center text-sm text-stone-500">{who} has nothing else to add online.</p> : null}
        <ul className="space-y-3">
          {options.map((s) => {
            const t = termsOf(s, mine.get(s.id));
            return <ServiceCard key={s.id} href={q({ time: sp.time, staff: slot.staffId, extra: [...extraIds, s.id].join(",") })} name={s.name} imageUrl={s.imageUrl} description={s.description} durationLabel={duration(t.durationMin + s.gapMin + s.finishMin)} price={money(t.priceCents)} />;
          })}
        </ul>
      </>
    );
  }

  let extras: PlannedExtra[] = [];
  let extraError: string | null = null;
  if (extraIds.length) {
    try {
      extras = await planExtras(business, { serviceId: service.id, staffId: slot.staffId, startAt, extraServiceIds: extraIds, locationId: locId });
    } catch (e) {
      if (e instanceof BookingError) extraError = e.message;
      else throw e;
    }
  }
  // When the added services don't fit after this time, offer the times that day when the whole visit fits with the same person.
  const fitTimes = extraError && date ? await timesThatFitVisit(business, { serviceId: service.id, staffId: slot.staffId, date, extraServiceIds: extraIds, locationId: locId }) : [];
  const ownPrice = termsFor(slot.staffId).priceCents;
  const visitPrice = ownPrice + extras.reduce((sum, x) => sum + x.priceCents, 0);
  const visitEnd = extras.length ? extras[extras.length - 1]!.endAt : null;
  const visitMinutes = visitEnd ? Math.round((visitEnd.getTime() - startAt.getTime()) / 60_000) : null;
  const req = onlinePaymentRequirement(business, service, pay, visitPrice);
  const extrasParam = extras.map((x) => x.serviceId);
  // "Add to your visit?": the add-ons the salon suggests with this service that this stylist performs and that fit right after it.
  // Ticked ones are already in the visit; an add-on that wouldn't fit after this time isn't offered at all.
  const pairings = await withTenant(business.id, (tx) => addonsForService(tx, service.id));
  const suggestions: { id: string; name: string; on: boolean; priceCents: number; regularPriceCents: number; minutes: number }[] = [];
  if (!extraError) {
    for (const p of pairings) {
      const s = services.find((x) => x.id === p.addonServiceId);
      if (!s || s.capacity !== 1 || (restricted.has(s.id) && !performs.has(s.id))) continue;
      const t = addonTerms(p, termsOf(s, mine.get(s.id)));
      const minutes = p.durationMin ?? t.durationMin + s.gapMin + s.finishMin;
      if (extraIds.includes(s.id)) {
        suggestions.push({ id: s.id, name: s.name, on: true, priceCents: t.priceCents, regularPriceCents: t.regularPriceCents, minutes });
        continue;
      }
      if (extraIds.length >= 4) continue;
      const fits = await planExtras(business, { serviceId: service.id, staffId: slot.staffId, startAt, extraServiceIds: [...extraIds, s.id], locationId: locId }).then(() => true, (e) => { if (e instanceof BookingError) return false; throw e; });
      if (fits) suggestions.push({ id: s.id, name: s.name, on: false, priceCents: t.priceCents, regularPriceCents: t.regularPriceCents, minutes });
    }
  }
  const addonIds = new Set(pairings.map((p) => p.addonServiceId));
  const moreOptions = options.filter((s) => !addonIds.has(s.id));

  // ---- Guests: others booked with this visit, each their own appointment (server/group-booking)
  const here = { time: sp.time, staff: slot.staffId };
  const withGuests = (list: GuestChoice[]) => q({ ...here, g: list.length ? encodeGuests(list) : undefined });
  const planFor = (list: GuestChoice[], at = startAt) => planGroup(business, { serviceId: service.id, staffId: slot.staffId, startAt: at, extraServiceIds: extrasParam, locationId: locId, guests: list });
  const tryPlan = (list: GuestChoice[], at = startAt) => planFor(list, at).then((p): GroupPlan | null => p, (e) => { if (e instanceof BookingError) return null; throw e; });
  let group: GroupPlan | null = null;
  let groupError: string | null = null;
  if (guests.length && !extraError) {
    try {
      group = await planFor(guests);
    } catch (e) {
      if (e instanceof BookingError) groupError = e.message;
      else throw e;
    }
  }
  // The lead's times that day with this provider, for "times when everyone fits".
  const leadSlotsToday = async () => (date ? (await getPublicSlots(business, service.id, slot.staffId, date, new Date(), locId)).filter((s) => s.free.includes(slot.staffId)).map((s) => s.at) : []);
  const fitsFor = async (list: GuestChoice[]) => {
    const out: Date[] = [];
    for (const at of (await leadSlotsToday()).slice(0, 48)) {
      if (await tryPlan(list, at)) out.push(at);
      if (out.length >= 6) break;
    }
    return out;
  };
  const groupFitTimes = groupError ? await fitsFor(guests) : [];
  const timeLabel = (d: Date) => formatTime(d, tz);
  const guestLine = (p: GroupPlan["guests"][number]) => `${[p.serviceName, ...p.extras.map((x) => x.name)].join(" + ")} with ${p.staffName.split(" ")[0]} at ${timeLabel(p.startAt)}`;

  if (sp.guest === "new" && !extraError && !groupError && guests.length < MAX_GUESTS) {
    const base = group ?? (await planFor([]));
    const guestService = services.find((x) => x.id === sp.gsvc && x.capacity === 1) ?? null;
    const back = withGuests(guests);
    if (!guestService) {
      // A long menu is browsed the way the first service was: search, or a top-level category, then its services.
      const oneToOne = services.filter((x) => x.capacity === 1);
      const liveCats = categories.filter((c) => subtreeIds(categories, c.id).some((cid) => oneToOne.some((x) => x.categoryId === cid)));
      const tops = buildTree(liveCats);
      const term = (sp.q ?? "").trim().toLowerCase().slice(0, 80);
      const cat = liveCats.find((c) => c.id === sp.gcat) ?? null;
      const browse = oneToOne.length > 12 && tops.length > 1;
      const shown = term ? oneToOne.filter((x) => `${x.name} ${x.description ?? ""} ${liveCats.find((c) => c.id === x.categoryId)?.name ?? ""}`.toLowerCase().includes(term)) : cat ? oneToOne.filter((x) => x.categoryId && subtreeIds(liveCats, cat.id).includes(x.categoryId)) : browse ? oneToOne.filter((x) => !x.categoryId || !liveCats.some((c) => c.id === x.categoryId)) : oneToOne;
      const keep = Object.fromEntries(new URLSearchParams(q({ ...here, guest: "new" }).slice(1)));
      return (
        <>
          <StepBack href={cat || term ? q({ ...here, guest: "new" }) : back} />
          {locBar}
          <Steps labels={stepLabels} current={4} hrefs={stepHrefs(3)} />
          <StepTitle title={`Add guest ${guests.length + 1}`} subtitle="What would they like? You'll pick who and when next." />
          <p className="mb-3 text-sm"><Link href={back} className="hit underline" style={{ color: "var(--brand-dark)" }}>Never mind, back to my details</Link></p>
          {oneToOne.length > 8 ? <ServiceSearch value={sp.q ?? ""} keep={keep} /> : null}
          {browse && !cat && !term ? (
            <div className={cn("grid grid-cols-2 gap-3 sm:grid-cols-3", shown.length && "mb-6")}>
              {tops.map((c) => <CategoryTile key={c.id} href={q({ ...here, guest: "new", gcat: c.id })} name={c.name} imageUrl={c.imageUrl ?? null} description={c.description ?? null} meta={`${oneToOne.filter((x) => x.categoryId && subtreeIds(liveCats, c.id).includes(x.categoryId)).length} services`} />)}
            </div>
          ) : null}
          {cat ? <h2 className="mb-2 text-sm font-semibold text-stone-700">{cat.name}</h2> : null}
          {term && !shown.length ? <p className="rounded-2xl border border-stone-200 bg-white p-6 text-center text-sm text-stone-500">Nothing matches that. Try a shorter word.</p> : null}
          <ul className="space-y-3">
            {shown.map((x) => <ServiceCard key={x.id} href={q({ ...here, guest: "new", gsvc: x.id })} name={x.name} imageUrl={x.imageUrl} description={x.description} durationLabel={serviceMeta(x)} price={priceLabel(ranges?.get(x.id) ?? { min: x.priceCents, max: x.priceCents }, money).label} priceFrom={priceLabel(ranges?.get(x.id) ?? { min: x.priceCents, max: x.priceCents }, money).varies} deposit={depositLabel(x, money) ?? undefined} />)}
          </ul>
        </>
      );
    }
    // Every way this guest could join: with each provider (or whoever is free), starting with the client or right after the last person.
    const pros = await publicProvidersFor(business, guestService.id, locId);
    const afterAt = (base.guests.at(-1) ?? base.lead).endAt;
    const prev = guests.length ? `guest ${guests.length}` : "you";
    const ways: { key: string; timing: "together" | "after"; staffId: string; label: string; plan: GroupPlan["guests"][number] }[] = [];
    for (const timing of ["together", "after"] as const) {
      for (const who of [...(pros.length > 1 ? [{ id: "any", displayName: "Any available provider" }] : []), ...pros]) {
        const choice: GuestChoice = { serviceId: guestService.id, staffId: who.id, timing, extraServiceIds: [] };
        const p = await tryPlan([...guests, choice]);
        if (p) ways.push({ key: `${timing}.${who.id}`, timing, staffId: who.id, label: who.id === "any" ? `Any available · ${p.guests.at(-1)!.staffName}` : who.displayName, plan: p.guests.at(-1)! });
      }
    }
    const fitTimesNew = ways.length ? [] : await fitsFor([...guests, { serviceId: guestService.id, staffId: "any", timing: "together", extraServiceIds: [] }]);
    const sections = [
      { timing: "together" as const, title: `At the same time · ${timeLabel(startAt)}` },
      { timing: "after" as const, title: `Right after ${prev} · ${timeLabel(afterAt)}` },
    ];
    return (
      <>
        <StepBack href={q({ ...here, g: sp.g, guest: "new" })} />
        {locBar}
        <Steps labels={stepLabels} current={4} hrefs={stepHrefs(3)} />
        <StepTitle title={`Who and when for guest ${guests.length + 1}?`} subtitle={`${guestService.name}. Only the choices that are free are shown.`} />
        <p className="mb-3 text-sm"><Link href={q({ ...here, guest: "new" })} className="hit underline" style={{ color: "var(--brand-dark)" }}>Pick a different service</Link></p>
        {sections.map((sec) => {
          const list = ways.filter((o) => o.timing === sec.timing);
          if (!list.length) return null;
          return (
            <section key={sec.timing} className="mb-5">
              <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-stone-500">{sec.title}</h2>
              <ul className="space-y-2">
                {list.map((o) => (
                  <li key={o.key}>
                    <Link href={withGuests([...guests, { serviceId: guestService.id, staffId: o.staffId, timing: o.timing, extraServiceIds: [] }])} className="flex min-h-14 items-center gap-3 rounded-2xl border border-stone-200 bg-white px-4 py-3 shadow-sm transition hover:border-[var(--brand-ring)] hover:shadow-md">
                      <span className="min-w-0 flex-1"><span className="block font-medium text-stone-900">{o.label}</span><span className="block text-xs text-stone-500">{timeLabel(o.plan.startAt)} – {timeLabel(o.plan.endAt)}</span></span>
                      <span className="w-20 shrink-0 text-right font-semibold tabular-nums text-stone-900">{money(o.plan.totalCents)}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
        {ways.length === 0 ? (
          <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
            <p>Nobody is free for {guestService.name} at {timeLabel(startAt)} or right after.</p>
            {fitTimesNew.length ? (
              <div className="mt-3">
                <p className="mb-2 font-medium">Times that day when everyone fits:</p>
                <div className="flex flex-wrap gap-2">
                  {fitTimesNew.map((t) => <Link key={t.getTime()} href={q({ ...here, time: t.toISOString(), g: encodeGuests([...guests, { serviceId: guestService.id, staffId: "any", timing: "together", extraServiceIds: [] }]) })} className="rounded-lg border border-amber-300 bg-white px-3 py-1.5 font-medium text-stone-800 hover:border-stone-400">{timeLabel(t)}</Link>)}
                </div>
              </div>
            ) : <p className="mt-2">Try another day, or <Link href={back} className="font-medium underline">go back</Link>.</p>}
          </div>
        ) : null}
      </>
    );
  }

  // Each guest's own "Add to your visit?": the add-ons suggested with their service that fit with everyone.
  const guestAddons: { id: string; name: string; on: boolean; priceCents: number }[][] = [];
  if (group) {
    for (const [i, g] of guests.entries()) {
      const pg = group.guests[i]!;
      const out: { id: string; name: string; on: boolean; priceCents: number }[] = [];
      const theirs = await withTenant(business.id, async (tx) => [await addonsForService(tx, g.serviceId), await overridesForStaff(tx, pg.staffId)] as const);
      for (const p of theirs[0]) {
        const svc = services.find((x) => x.id === p.addonServiceId);
        if (!svc || svc.capacity !== 1) continue;
        const on = g.extraServiceIds.includes(svc.id);
        const t = addonTerms(p, termsOf(svc, theirs[1].get(svc.id)));
        if (!on) {
          // Pinned to the provider they got, so "any" doesn't hop to someone else to make room.
          const next = guests.map((x, j) => (j === i ? { ...x, staffId: pg.staffId, extraServiceIds: [...x.extraServiceIds, svc.id] } : x));
          if (!(await tryPlan(next))) continue;
        }
        out.push({ id: svc.id, name: svc.name, on, priceCents: t.priceCents });
      }
      guestAddons.push(out);
    }
  }
  const toggleGuestAddon = (i: number, id: string) => withGuests(guests.map((x, j) => (j !== i ? x : x.extraServiceIds.includes(id) ? { ...x, extraServiceIds: x.extraServiceIds.filter((e) => e !== id) } : { ...x, staffId: group!.guests[i]!.staffId, extraServiceIds: [...x.extraServiceIds, id] })));
  const groupReq = group ? groupPaymentRequirement(business, pay, group) : null;
  const groupTotal = group ? [group.lead, ...group.guests].reduce((sum, p) => sum + p.totalCents, 0) : null;
  const formReq = groupReq ?? req;
  // A signed-in client's family: they can book this visit for one of them, and pick them as guests.
  const family = me ? (await linkedClients(business.id, me.id)).map((f) => ({ id: f.id, name: `${f.firstName} ${f.lastName}`.trim(), relation: f.relation })) : [];
  const guestForm = group ? { encoded: encodeGuests(guests), people: group.guests.map((p, i) => ({ label: `Guest ${i + 1} · ${guestLine(p)}` })), family } : undefined;
  return (
    <>
      <StepBack href={timeFirst ? q({ staff: undefined }) : q({ time: undefined })} />
      {locBar}
      <Steps labels={stepLabels} current={4} hrefs={stepHrefs(3)} />
      <StepTitle title="Your details" subtitle="Almost done. Tell us who you are and we'll hold this time." />
      <Summary
        imageUrl={service.imageUrl}
        title={service.name}
        rows={[
          { label: "When", value: `${formatDateLong(date)} at ${formatTime(startAt, tz)}`, href: timeFirst ? q({ time: undefined, staff: undefined }) : q({ time: undefined }) },
          { label: "With", value: withTitle(slot.staffId, slot.staffName), href: timeFirst ? q({ staff: undefined }) : q({ staff: undefined, date: undefined, time: undefined }) },
          ...extras.map((x) => ({ label: "Plus", value: `${x.name}${x.addon ? " (add-on)" : ""} · ${money(x.priceCents)}`, href: q({ time: sp.time, extra: extrasParam.filter((id) => id !== x.serviceId).join(",") || undefined }) })),
          { label: "Duration", value: visitMinutes ? duration(visitMinutes) : spanOf(termsFor(slot.staffId).durationMin) },
          { label: extras.length ? "Total" : "Price", value: money(visitPrice) },
          ...(group && groupTotal !== null ? [{ label: "Everyone", value: `${money(groupTotal)} · ${group.guests.length + 1} people` }] : []),
        ]}
      />
      {pricierNote(slot.staffId, slot.staffName)}
      {extraError ? (
        <div className="mb-4 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          <p>{extraError} <Link href={q({ time: sp.time, extra: undefined })} className="font-medium underline">Remove added services</Link> or <Link href={q({ time: undefined })} className="font-medium underline">pick another time</Link>.</p>
          {fitTimes.length ? (
            <div className="mt-3">
              <p className="mb-2 font-medium">Times that day when everything fits with {slot.staffName}:</p>
              <div className="flex flex-wrap gap-2">
                {fitTimes.map((t) => <Link key={t.getTime()} href={q({ time: t.toISOString(), staff: slot.staffId, extra: extraIds.join(",") })} className="rounded-lg border border-amber-300 bg-white px-3 py-1.5 font-medium text-stone-800 hover:border-stone-400">{formatTime(t, tz)}</Link>)}
              </div>
            </div>
          ) : null}
        </div>
      ) : (
        <>
          {suggestions.length ? (
            <section className="mb-4 rounded-2xl border border-stone-200 bg-white p-4" aria-labelledby="addons-title">
              <h2 id="addons-title" className="font-medium">Add to your visit?</h2>
              <p className="mb-2 text-xs text-stone-500">Popular with {service.name}, done right after it by {slot.staffName.split(" ")[0]}.</p>
              <ul className="divide-y divide-stone-100">
                {suggestions.map((a) => (
                  <li key={a.id}>
                    <Link
                      href={q({ time: sp.time, staff: slot.staffId, extra: (a.on ? extraIds.filter((id) => id !== a.id) : [...extraIds, a.id]).join(",") || undefined })}
                      scroll={false}
                      role="checkbox"
                      aria-checked={a.on}
                      className="flex min-h-12 items-center gap-3 py-2"
                    >
                      <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded border ${a.on ? "border-transparent text-white" : "border-stone-300 bg-white"}`} style={a.on ? { background: "var(--brand)" } : undefined} aria-hidden>{a.on ? "✓" : null}</span>
                      <span className="min-w-0 flex-1 text-sm">{a.name} <span className="text-stone-500">· +{duration(a.minutes)}</span></span>
                      <span className="whitespace-nowrap text-sm font-medium">+{money(a.priceCents)}{a.priceCents < a.regularPriceCents ? <s className="ml-1.5 font-normal text-stone-400">{money(a.regularPriceCents)}</s> : null}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
          {moreOptions.length ? <p className="mb-3 text-sm"><Link href={q({ time: sp.time, staff: slot.staffId, add: "1" })} className="underline" style={{ color: "var(--brand-dark)" }}>+ Add another service with {slot.staffName.split(" ")[0]}</Link></p> : null}
          {groupError ? (
            <div className="mb-4 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
              <p>{groupError} <Link href={withGuests([])} className="font-medium underline">Remove guests</Link> or <Link href={q({ time: undefined })} className="font-medium underline">pick another time</Link>.</p>
              {groupFitTimes.length ? (
                <div className="mt-3">
                  <p className="mb-2 font-medium">Times that day when everyone fits:</p>
                  <div className="flex flex-wrap gap-2">
                    {groupFitTimes.map((t) => <Link key={t.getTime()} href={q({ ...here, time: t.toISOString() })} className="rounded-lg border border-amber-300 bg-white px-3 py-1.5 font-medium text-stone-800 hover:border-stone-400">{timeLabel(t)}</Link>)}
                  </div>
                </div>
              ) : null}
            </div>
          ) : group ? (
            <section className="mb-4 rounded-2xl border border-stone-200 bg-white p-4" aria-labelledby="guests-title">
              <h2 id="guests-title" className="font-medium">Your guests</h2>
              <p className="mb-2 text-xs text-stone-500">Each guest gets their own appointment. You'll enter their names below.</p>
              <ul className="divide-y divide-stone-100">
                {group.guests.map((p, i) => (
                  <li key={i} className="py-2">
                    <div className="flex items-start gap-3">
                      <span className="min-w-0 flex-1 text-sm"><span className="block font-medium text-stone-900">Guest {i + 1}</span><span className="block text-stone-600">{guestLine(p)}{guests[i]!.timing === "after" ? " · right after" : ""}</span></span>
                      <span className="w-20 shrink-0 text-right text-sm font-medium tabular-nums">{money(p.totalCents)}</span>
                      <Link href={withGuests(guests.filter((_, j) => j !== i))} scroll={false} className="hit shrink-0 text-sm text-stone-500 underline">Remove</Link>
                    </div>
                    {guestAddons[i]?.length ? (
                      <ul className="mt-1">
                        {guestAddons[i]!.map((a) => (
                          <li key={a.id}>
                            <Link href={toggleGuestAddon(i, a.id)} scroll={false} role="checkbox" aria-checked={a.on} className="flex min-h-10 items-center gap-3 py-1">
                              <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded border ${a.on ? "border-transparent text-white" : "border-stone-300 bg-white"}`} style={a.on ? { background: "var(--brand)" } : undefined} aria-hidden>{a.on ? "✓" : null}</span>
                              <span className="min-w-0 flex-1 text-sm text-stone-700">Add {a.name}</span>
                              <span className="whitespace-nowrap text-sm">+{money(a.priceCents)}</span>
                            </Link>
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </li>
                ))}
              </ul>
              {guests.length < MAX_GUESTS ? <p className="mt-2 text-sm"><Link href={q({ ...here, guest: "new" })} className="hit underline" style={{ color: "var(--brand-dark)" }}>+ Add another guest</Link></p> : null}
            </section>
          ) : (
            <p className="mb-3 text-sm"><Link href={q({ ...here, guest: "new" })} className="hit underline" style={{ color: "var(--brand-dark)" }}>+ Booking for someone else too? Add a guest</Link></p>
          )}
          {formReq.mode === "none" && depositLabel(service, money) ? <p className="mb-3 text-xs text-stone-600">This service takes {depositLabel(service, money)!.toLowerCase()} up front. The salon will contact you to arrange it.</p> : null}
          {groupError ? null : formReq.mode === "none" ? (
            <BookingForm verify={verifyCode} priceLabel={money(groupTotal ?? visitPrice)} guests={guestForm} family={family} extraServiceIds={extrasParam} slug={slug} serviceId={service.id} staffId={slot.staffId} startAt={startAt.toISOString()} quotedPriceCents={ownPrice} policy={business.bookingPolicy} cancelWindowHours={business.cancelWindowHours} lateFee={lateFee} referrals={business.loyaltyEnabled} defaults={defaults} promos={hasPromos} embed={embed} locationId={locId} photos={business.clientPhotosOnBooking} />
          ) : (
            <PaidBookingForm verify={verifyCode}
              priceLabel={money(groupTotal ?? visitPrice)}
              guests={guestForm}
              family={family}
              extraServiceIds={extrasParam}
              slug={slug}
              serviceId={service.id}
              staffId={slot.staffId}
              startAt={startAt.toISOString()}
              quotedPriceCents={ownPrice}
              policy={business.bookingPolicy}
              cancelWindowHours={business.cancelWindowHours} lateFee={lateFee}
              mode={formReq.mode}
              full={formReq.full}
              amountLabel={formatMoney(formReq.amountCents, business.currency)}
              amountCents={formReq.amountCents}
              currency={business.currency}
              cardFee={formReq.mode === "deposit" ? cardFeeQuote(cardFeeSettingsOf(business), pay.provider, "online", formReq.amountCents, business.currency, { cashOption: false }) : null}
              publishableKey={process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY!}
              brand={brandHex(business.brandColor)}
              referrals={business.loyaltyEnabled}
              defaults={defaults}
              promos={hasPromos}
              embed={embed}
              locationId={locId}
              photos={business.clientPhotosOnBooking}
            />
          )}
        </>
      )}
    </>
  );
}
