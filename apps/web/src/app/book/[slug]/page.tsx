import Link from "next/link";
import { headers } from "next/headers";
import { ChevronRight, MapPin } from "lucide-react";
import { instantToISODate, weekdayOf, lateCancelFeeLabel, policyFeeCheck } from "@angelic/core";
import { getAvailableDates, getPublicBusiness, getPublicLocations, getPublicMenu, getPublicSlots, publicProvidersFor } from "@/server/public-booking";
import { buildTree, pathTo, subtreeIds } from "@/server/categories";
import { formatDateLong, formatMoney, formatTime, shiftISODate, cn } from "@/lib/utils";
import { duration } from "@/lib/format";
import { BookingForm, WaitlistForm } from "./forms";
import { PaidBookingForm } from "./payment-form";
import { depositLabel, onlinePaymentRequirement } from "@/server/online-payments";
import { paymentContextFor, tzFor } from "@/server/locations";
import { publicSessions } from "@/server/classes";
import { overridesForService, priceLabel, servicePriceRanges, termsOf } from "@/server/stylist-pricing";
import { brandHex } from "@/lib/brand";
import { hoursToday } from "@/lib/hours";
import { currentClient } from "@/server/client-auth";
import { schema, withTenant } from "@angelic/db";
import { eq } from "drizzle-orm";
import { CategoryTile, Crumbs, ServiceCard, Steps, StepTitle, Summary } from "./ui";
import { ServiceSearch } from "./service-search";
import { MonthCalendar } from "./calendar";

type SP = { service?: string; staff?: string; date?: string; time?: string; month?: string; location?: string; session?: string; category?: string; q?: string };

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
  const latePolicy = { feeType: business.lateCancelFeeType as "none" | "flat" | "percent", feeValue: business.lateCancelFeeValue, deposit: business.lateCancelDeposit as "toward" | "extra" };
  const lateFee = policyFeeCheck(business.bookingPolicy, latePolicy).repeats.length ? null : lateCancelFeeLabel(latePolicy, (c) => formatMoney(c, business.currency));
  const defaults = me ? { firstName: me.firstName, lastName: me.lastName, phone: me.phone, email: me.email, smsOptIn: me.smsOptIn } : null;
  const tz = tzFor(business, location);
  const today = instantToISODate(new Date(), tz);
  const service = services.find((s) => s.id === sp.service) ?? null;
  // Only providers who perform this service (and are bookable online here) are offered.
  const providerIds = service ? new Set((await publicProvidersFor(business, service.id, locId)).map((s) => s.id)) : null;
  const providers = providerIds ? staff.filter((s) => providerIds.has(s.id)) : staff;
  // One provider: nothing to choose, so the step is skipped.
  const onlyProvider = service && providers.length === 1 ? providers[0]!.id : null;
  const staffChoice = sp.staff === "any" || providers.some((s) => s.id === sp.staff) ? sp.staff! : onlyProvider;
  const date = /^\d{4}-\d{2}-\d{2}$/.test(sp.date ?? "") ? sp.date! : null;
  const q = (extra: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries({ location: locations.length > 1 ? location?.id : undefined, category: service?.categoryId ?? sp.category, service: service?.id, staff: staffChoice ?? undefined, date: date ?? undefined, ...extra })) if (v) p.set(k, v);
    return `?${p.toString()}`;
  };
  const locBar = locations.length > 1 && location ? (
    <p className="mb-3 flex items-center gap-1.5 text-sm text-stone-600"><MapPin className="h-4 w-4 text-stone-400" aria-hidden />{location.name}<Link href="?" className="text-xs underline" style={{ color: "var(--brand-dark)" }}>Change</Link></p>
  ) : null;
  const stepHrefs = (upTo: number) => [q({ service: undefined, staff: undefined, date: undefined, time: undefined, session: undefined }), onlyProvider ? null : q({ staff: undefined, date: undefined, time: undefined }), q({ time: undefined }), null].map((h, i) => (i < upTo ? h : null));
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
  const durationVaries = new Set(provTerms.map((t) => t.durationMin)).size > 1;
  const scope = staffChoice && staffChoice !== "any" ? provTerms.filter((t) => t.id === staffChoice) : provTerms;
  const scopePrices = scope.length ? scope.map((t) => t.priceCents) : [service.priceCents];
  const scopeMins = scope.length ? scope.map((t) => t.durationMin) : [service.durationMin];
  const fromIf = (min: number, max: number, text: string) => (min === max ? text : `from ${text}`);
  const priceText = fromIf(Math.min(...scopePrices), Math.max(...scopePrices), money(Math.min(...scopePrices)));
  const spanOf = (mins: number) => duration(mins + service.gapMin + service.finishMin);
  const durationText = fromIf(Math.min(...scopeMins), Math.max(...scopeMins), spanOf(Math.min(...scopeMins)));
  const providerName = staffChoice === "any" ? "Any available provider" : staff.find((s) => s.id === staffChoice)?.displayName;
  const summaryRows = (extra: { label: string; value: string; href?: string }[] = []) => [
    { label: "Duration", value: durationText },
    ...(staffChoice ? [{ label: "With", value: providerName ?? "", href: onlyProvider ? undefined : q({ staff: undefined, date: undefined, time: undefined }) }] : []),
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
          {locBar}
          <Steps labels={classLabels} current={2} hrefs={[q({ service: undefined }), null, null]} />
          <StepTitle title="Pick a class" />
          <Summary imageUrl={service.imageUrl} title={service.name} rows={[{ label: "Per person", value: formatMoney(service.priceCents, business.currency) }, { label: "Duration", value: serviceMeta(service), href: q({ service: undefined }) }]} />
          {service.description ? <p className="mb-4 text-sm text-stone-600">{service.description}</p> : null}
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
        {locBar}
        <Steps labels={classLabels} current={3} hrefs={[q({ service: undefined, session: undefined }), q({ session: undefined }), null]} />
        <StepTitle title="Your details" />
        <Summary imageUrl={service.imageUrl} title={service.name} rows={[{ label: "When", value: `${formatDateLong(sessionDate)} at ${formatTime(chosen.startAt, tz)}`, href: q({ session: undefined }) }, { label: "With", value: chosen.staffName }, { label: "Per person", value: formatMoney(service.priceCents, business.currency) }, { label: "Seats left", value: String(chosen.seatsLeft) }]} />
        {req.mode === "deposit" ? <p className="mb-3 text-xs text-stone-600">{req.full ? `Payment of ${formatMoney(req.amountCents, business.currency)} in full is due now.` : `A ${formatMoney(req.amountCents, business.currency)} deposit is due now and comes off your bill.`}</p> : req.mode === "card" ? <p className="mb-3 text-xs text-stone-600">A card is needed to hold your seat. Nothing is charged now.</p> : null}
        {req.mode === "none" ? (
          <BookingForm slug={slug} serviceId={service.id} staffId={chosen.staffId} startAt={chosen.startAt.toISOString()} policy={business.bookingPolicy} cancelWindowHours={business.cancelWindowHours} lateFee={lateFee} classSessionId={chosen.id} referrals={business.loyaltyEnabled} defaults={defaults} promos={hasPromos} embed={embed} locationId={locId} />
        ) : (
          <PaidBookingForm slug={slug} serviceId={service.id} staffId={chosen.staffId} startAt={chosen.startAt.toISOString()} policy={business.bookingPolicy} cancelWindowHours={business.cancelWindowHours} lateFee={lateFee} mode={req.mode} full={req.full} amountLabel={formatMoney(req.amountCents, business.currency)} publishableKey={process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY!} brand={brandHex(business.brandColor)} classSessionId={chosen.id} referrals={business.loyaltyEnabled} defaults={defaults} promos={hasPromos} embed={embed} locationId={locId} />
        )}
      </>
    );
  }

  // ---- Step 2: staff
  if (!staffChoice) {
    return (
      <>
        {locBar}
        <Steps labels={stepLabels} current={2} hrefs={stepHrefs(1)} />
        <StepTitle title="Choose a provider" />
        <Summary imageUrl={service.imageUrl} title={service.name} rows={[{ label: "Price", value: priceText }, ...depositRow, { label: "Duration", value: durationText, href: q({ service: undefined }) }]} />
        <ul className="grid gap-3 sm:grid-cols-2">
          <li>
            <Link href={q({ staff: "any" })} className="flex items-center gap-3 rounded-2xl border-2 border-dashed border-stone-300 bg-white p-4 transition hover:border-[var(--brand)] hover:shadow-md">
              <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full text-lg font-semibold text-white" style={{ background: "var(--brand)" }}>✦</span>
              <span><span className="block font-semibold text-stone-900">Any available provider</span><span className="block text-xs text-stone-500">Shows the most openings{priceVaries ? ` · ${priceText}` : ""}</span></span>
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
                {priceVaries || durationVaries ? (
                  <span className="ml-auto shrink-0 text-right">
                    {priceVaries ? <span className="block font-semibold text-stone-900">{money(termsFor(s.id).priceCents)}</span> : null}
                    {durationVaries ? <span className="block text-[11px] text-stone-500">{spanOf(termsFor(s.id).durationMin)}</span> : null}
                  </span>
                ) : null}
              </Link>
            </li>
          ))}
        </ul>
        {providers.length === 0 ? <p className="mt-3 text-sm text-stone-500">No one is set up to take this service online yet. <Link href={q({ service: undefined })} className="font-medium underline">Pick another service</Link>{callUs}.</p> : null}
      </>
    );
  }

  // ---- Step 3: date + time
  if (!date || !sp.time) {
    const monthStart = /^\d{4}-\d{2}$/.test(sp.month ?? "") ? `${sp.month}-01` : `${today.slice(0, 7)}-01`;
    const daysInMonth = new Date(Date.UTC(Number(monthStart.slice(0, 4)), Number(monthStart.slice(5, 7)), 0)).getUTCDate();
    const maxDate = shiftISODate(today, business.maxAdvanceDays);
    // Only the part of the month that can be booked is checked for openings.
    const rangeStart = monthStart < today ? today : monthStart;
    const monthEnd = shiftISODate(monthStart, daysInMonth - 1);
    const rangeEnd = monthEnd < maxDate ? monthEnd : maxDate;
    const rangeDays = rangeEnd < rangeStart ? 0 : Math.round((Date.parse(`${rangeEnd}T00:00:00Z`) - Date.parse(`${rangeStart}T00:00:00Z`)) / 86_400_000) + 1;
    const available = new Set(await getAvailableDates(business, service.id, staffChoice as "any" | string, rangeStart, rangeDays, locId));
    const slots = date ? await getPublicSlots(business, service.id, staffChoice as "any" | string, date, new Date(), locId) : [];
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
        {locBar}
        <Steps labels={stepLabels} current={3} hrefs={stepHrefs(2)} />
        <StepTitle title="Pick a time" />
        <Summary imageUrl={service.imageUrl} title={service.name} rows={summaryRows([{ label: "Price", value: priceText }, ...depositRow])} />
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
            ) : slots.length === 0 ? (
              <div className="space-y-3">
                <p className="text-sm text-stone-600">No openings on {formatDateLong(date)}.</p>
                <WaitlistForm slug={slug} serviceId={service.id} staffId={staffChoice} date={date} locationId={locId} defaults={defaults} />
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
                          {formatTime(s.at, tz)}{staffChoice === "any" ? <><span className="block truncate text-[10px] font-normal text-stone-500">{s.staffName}</span>{priceVaries ? <span className="block text-[10px] font-medium text-stone-700">{money(termsFor(s.staffId).priceCents)}</span> : null}</> : null}
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
        {locBar}
        <Steps labels={stepLabels} current={4} hrefs={stepHrefs(3)} />
        <StepTitle title="Your details" />
        <p className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">That time was just taken or is no longer open. <Link href={q({ time: undefined })} className="font-medium underline">Pick another time</Link>.</p>
      </>
    );
  }
  const req = onlinePaymentRequirement(business, service, pay, termsFor(slot.staffId).priceCents);
  return (
    <>
      {locBar}
      <Steps labels={stepLabels} current={4} hrefs={stepHrefs(3)} />
      <StepTitle title="Your details" subtitle="Almost done. Tell us who you are and we'll hold this time." />
      <Summary imageUrl={service.imageUrl} title={service.name} rows={[{ label: "When", value: `${formatDateLong(date)} at ${formatTime(startAt, tz)}`, href: q({ time: undefined }) }, { label: "With", value: slot.staffName, href: onlyProvider ? undefined : q({ staff: undefined, date: undefined, time: undefined }) }, { label: "Duration", value: spanOf(termsFor(slot.staffId).durationMin) }, { label: "Price", value: money(termsFor(slot.staffId).priceCents) }]} />
      {req.mode === "deposit" ? <p className="mb-3 text-xs text-stone-600">{req.full ? `Payment of ${formatMoney(req.amountCents, business.currency)} in full is due now.` : `A ${formatMoney(req.amountCents, business.currency)} deposit is due now and comes off your bill.`}</p> : req.mode === "card" ? <p className="mb-3 text-xs text-stone-600">A card is needed to hold this booking. Nothing is charged now.</p> : depositLabel(service, money) ? <p className="mb-3 text-xs text-stone-600">This service takes {depositLabel(service, money)!.toLowerCase()} up front. The salon will contact you to arrange it.</p> : null}
      {req.mode === "none" ? (
        <BookingForm slug={slug} serviceId={service.id} staffId={slot.staffId} startAt={startAt.toISOString()} quotedPriceCents={termsFor(slot.staffId).priceCents} policy={business.bookingPolicy} cancelWindowHours={business.cancelWindowHours} lateFee={lateFee} referrals={business.loyaltyEnabled} defaults={defaults} promos={hasPromos} embed={embed} locationId={locId} />
      ) : (
        <PaidBookingForm
          slug={slug}
          serviceId={service.id}
          staffId={slot.staffId}
          startAt={startAt.toISOString()}
          quotedPriceCents={termsFor(slot.staffId).priceCents}
          policy={business.bookingPolicy}
          cancelWindowHours={business.cancelWindowHours} lateFee={lateFee}
          mode={req.mode}
          full={req.full}
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
