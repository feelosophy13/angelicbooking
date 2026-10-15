import type { Metadata } from "next";
import { and, asc, eq } from "drizzle-orm";

export const metadata: Metadata = { title: "New appointment" };
import { schema, withTenant } from "@angelic/db";
import { instantToISODate, zonedToInstant } from "@angelic/core";
import { requireBookingAccess } from "@/server/appointment-access";
import { getStaffAvailability, staffForService, timingFor } from "@/server/availability";
import { overridesForService, overridesForStaff, termsOf, type Override } from "@/server/stylist-pricing";
import { formatDateLong, formatMoney, formatTime } from "@/lib/utils";
import { duration } from "@/lib/format";
import Link from "next/link";
import { Card, Field, Input, Label, PageHeader, Select, Empty } from "@/components/ui";
import { AutoSubmitForm } from "@/components/auto-submit-form";
import { ServicePicker, type ServiceGroup } from "@/components/service-picker";
import { groupServices } from "@/server/service-groups";
import { listCategories, pathTo } from "@/server/categories";
import { BookForm } from "./book-form";
import { ClientPicker } from "@/components/client-picker";
import { quickCreateClient } from "../../clients/actions";
import { can } from "@angelic/core";
import { listLocations, servicesHiddenAt, staffIdsAt, staffLocationIndex, tzFor } from "@/server/locations";

type SP = { date?: string; serviceId?: string; staffId?: string; clientId?: string; time?: string; location?: string; extra?: string | string[] };

export default async function NewAppointmentPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<SP>;
}) {
  const { slug } = await params;
  const sp = await searchParams;
  const { business, permissions, access, staffId: myStaffId } = await requireBookingAccess(slug);
  const locations = await listLocations(business.id);
  const multi = locations.length > 1;
  // Multi-site businesses pick the location first; it filters services, providers, open times and the clock shown.
  const location = multi ? (locations.find((l) => l.id === sp.location) ?? locations.find((l) => l.isDefault) ?? locations[0] ?? null) : null;
  const tz = tzFor(business, location);
  const date = /^\d{4}-\d{2}-\d{2}$/.test(sp.date ?? "") ? sp.date! : instantToISODate(new Date(), tz);

  const { services, client, categories, providersHere, mapping, providerCount, locIndex } = await withTenant(business.id, async (tx) => {
    const hidden = await servicesHiddenAt(tx, location?.id);
    const providers = await tx.select({ id: schema.staff.id }).from(schema.staff).where(and(eq(schema.staff.active, true), eq(schema.staff.takesAppointments, true)));
    const here = await staffIdsAt(tx, location?.id);
    return {
      services: (await tx.select().from(schema.services).where(eq(schema.services.active, true)).orderBy(asc(schema.services.sortOrder), asc(schema.services.name))).filter((s) => !hidden.has(s.id)),
      // Only the chosen client is loaded; the picker searches the rest as you type.
      client: sp.clientId ? await tx.query.clients.findFirst({ where: eq(schema.clients.id, sp.clientId), columns: { id: true, firstName: true, lastName: true } }) : null,
      categories: await listCategories(business.id, "service"),
      providersHere: here ? providers.filter((p) => here.has(p.id)) : providers,
      mapping: await tx.select({ staffId: schema.staffServices.staffId, serviceId: schema.staffServices.serviceId }).from(schema.staffServices),
      providerCount: providers.length,
      locIndex: multi ? await staffLocationIndex(tx) : null,
    };
  });
  // How many providers at this site can do each service (a service nobody is assigned to: everyone can).
  const mappedTo = new Map<string, Set<string>>();
  for (const m of mapping) mappedTo.set(m.serviceId, (mappedTo.get(m.serviceId) ?? new Set()).add(m.staffId));
  const hereCount = (serviceId: string) => { const m = mappedTo.get(serviceId); return m?.size ? providersHere.filter((p) => m.has(p.id)).length : providersHere.length; };
  // Grouped like everywhere else (menu order, indented), flagging services nobody here can do.
  const serviceGroups: ServiceGroup[] = groupServices(services, categories, business.currency, { note: (id) => (hereCount(id) === 0 ? (multi ? "no one here" : "no provider") : null) });

  const service = services.find((s) => s.id === sp.serviceId) ?? services[0] ?? null;
  // More services on the same visit, booked back to back with the same provider.
  const extraIds = (Array.isArray(sp.extra) ? sp.extra : sp.extra ? [sp.extra] : []).filter((id) => id && id !== service?.id);
  const extras = extraIds.map((id) => services.find((s) => s.id === id)).filter((s): s is NonNullable<typeof s> => !!s);
  const preselectTime = /^\d{2}:\d{2}$/.test(sp.time ?? "") ? sp.time! : null;
  // Someone who may only book for themselves sees only their own calendar here.
  const eligibleStaff = (service ? await staffForService(business.id, service.id, location?.id) : []).filter((s) => access === "any" || s.id === myStaffId);
  // "Any available": the desk picks a time and whoever is free then gets it. The default when several people can do the service.
  const canAny = eligibleStaff.length > 1;
  const anyMode = canAny && (sp.staffId === "any" || !eligibleStaff.some((s) => s.id === sp.staffId));
  // In "any" mode the first person stands in for the price and length shown; each time is checked against its own person.
  const staffId = anyMode ? eligibleStaff[0]?.id : eligibleStaff.some((s) => s.id === sp.staffId) ? sp.staffId! : eligibleStaff[0]?.id;
  // When nobody here can do it: who can, and where, so the desk knows what to do next.
  const performersAnywhere = service && !staffId ? await staffForService(business.id, service.id) : [];
  const locName = (id: string) => (locations.find((l) => l.id === id)?.name ?? "").replace(`${business.name} - `, "");
  const worksAtNames = (sid: string) => [...(locIndex?.any.get(sid) ?? [])].map(locName).filter(Boolean);
  const switchTo = (locId: string) => { const p = new URLSearchParams(); p.set("location", locId); if (service) p.set("serviceId", service.id); if (sp.clientId) p.set("clientId", sp.clientId); p.set("date", date); return `?${p.toString()}`; };
  // This stylist's own price and length for each service in the chain, and every stylist's for the main one.
  const { svcOverrides, staffOverrides } = await withTenant(business.id, async (tx) => ({
    svcOverrides: service ? await overridesForService(tx, service.id) : new Map<string, Override>(),
    staffOverrides: staffId ? await overridesForStaff(tx, staffId) : new Map<string, Override>(),
  }));
  const termsFor = (svc: { id: string; priceCents: number; durationMin: number }) => termsOf(svc, staffOverrides.get(svc.id));
  const mainTerms = service ? termsFor(service) : null;
  // Open times must fit the whole chain: the first service's timing plus every extra, end to end.
  const chainMin = extras.reduce((s, x) => s + termsFor(x).durationMin + x.gapMin + x.finishMin + x.bufferAfterMin, 0);
  const availabilityFor = (sid: string, main: { durationMin: number }, chain: number) =>
    getStaffAvailability({
      businessId: business.id,
      timeZone: tz,
      slotIntervalMin: business.slotIntervalMin,
      staffId: sid,
      date,
      service: chain > 0 ? { durationMin: main.durationMin + service!.gapMin + service!.finishMin + service!.bufferAfterMin + chain, gapMin: 0, finishMin: 0, bufferAfterMin: 0 } : timingFor({ ...service!, durationMin: main.durationMin }),
      notBefore: new Date(),
      locationId: location?.id,
    });
  let slots: { at: Date; staffId: string }[] = [];
  if (service && staffId && anyMode) {
    // Every eligible person's open times, merged; a time two people share goes to whoever comes first on the staff list.
    const taken = new Map<number, string>();
    for (const s of eligibleStaff) {
      const so = await withTenant(business.id, (tx) => overridesForStaff(tx, s.id));
      const tf = (svc: { id: string; priceCents: number; durationMin: number }) => termsOf(svc, so.get(svc.id));
      const chain = extras.reduce((sum, x) => sum + tf(x).durationMin + x.gapMin + x.finishMin + x.bufferAfterMin, 0);
      for (const at of await availabilityFor(s.id, tf(service), chain)) if (!taken.has(at.getTime())) taken.set(at.getTime(), s.id);
    }
    slots = [...taken].sort((a, b) => a[0] - b[0]).map(([t, sid]) => ({ at: new Date(t), staffId: sid }));
  } else if (service && staffId) {
    slots = (await availabilityFor(staffId, mainTerms!, chainMin)).map((at) => ({ at, staffId }));
  }
  const chainPrice = (mainTerms?.priceCents ?? 0) + extras.reduce((s, x) => s + termsFor(x).priceCents, 0);
  const chainLabel = service ? [service, ...extras].map((s) => s.name).join(" + ") : "";

  return (
    <>
      <PageHeader title="New appointment" />
      <div className="grid gap-6 lg:grid-cols-[360px_1fr]">
        <Card className="p-4">
          <AutoSubmitForm className="space-y-3">
            {multi ? (
              <Field label="Location">
                <Select name="location" defaultValue={location?.id ?? ""}>
                  {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
                </Select>
              </Field>
            ) : null}
            <div>
              <Label>Client</Label>
              <ClientPicker slug={slug} initial={client ? { id: client.id, name: `${client.firstName} ${client.lastName}`.trim() } : null} canCreate={can(permissions, "clients.write")} createClient={quickCreateClient} />
            </div>
            <Field label="Service" name="serviceId">
              <ServicePicker name="serviceId" groups={serviceGroups} value={service?.id ?? null} />
            </Field>
            {[...extras, null].map((x, i) => (
              <Field key={x?.id ?? "new"} label={i === 0 && !x ? "Add another service (optional)" : x ? `Also: ${x.name}` : "Add another service"} name={`extra-${i}`}>
                <ServicePicker name="extra" groups={serviceGroups.map((g) => ({ ...g, services: g.services.filter((s) => s.id !== service?.id) })).filter((g) => g.services.length)} value={x?.id ?? null} placeholder="None" noneLabel={x ? "Remove this one" : "None"} />
              </Field>
            ))}
            <Field label="Staff">
              <Select name="staffId" defaultValue={anyMode ? "any" : (staffId ?? "")} disabled={!service}>
                {canAny ? <option value="any">Any available</option> : null}
                {eligibleStaff.map((s) => {
                  const t = service ? termsOf(service, svcOverrides.get(s.id)) : null;
                  const note = t ? [t.priceCustom ? formatMoney(t.priceCents, business.currency) : null, t.durationCustom ? duration(t.durationMin) : null].filter(Boolean).join(" · ") : "";
                  return <option key={s.id} value={s.id}>{s.displayName}{note ? ` · ${note}` : ""}</option>;
                })}
              </Select>
            </Field>
            <Field label="Date"><Input name="date" type="date" defaultValue={date} /></Field>
          </AutoSubmitForm>
        </Card>

        <div>
          {!service ? (
            <Empty title="Pick a service to see open times" />
          ) : !staffId ? (
            <Card className="p-5 text-sm">
              {performersAnywhere.length ? (
                <>
                  <p className="font-medium text-stone-900">No one at {location ? locName(location.id) : "this site"} does {service.name}.</p>
                  <ul className="mt-2 space-y-1 text-stone-700">
                    {performersAnywhere.map((p) => {
                      const sites = worksAtNames(p.id);
                      return <li key={p.id}>{p.displayName}{sites.length ? <> does it at {sites.map((n, i) => { const id = locations.find((l) => locName(l.id) === n)?.id; return <span key={n}>{i ? ", " : " "}{id ? <Link href={switchTo(id)} className="text-brand-700 underline">{n}</Link> : n}</span>; })}</> : " does it but has no weekly hours yet"}</li>;
                    })}
                  </ul>
                  <p className="mt-3 text-xs text-stone-500">Pick one of those sites, or give someone here this service under <Link href={`/app/${slug}/staff`} className="text-brand-700 underline">Staff → Services</Link> and a day here under Weekly hours.</p>
                </>
              ) : providerCount === 0 ? (
                <>
                  <p className="font-medium text-stone-900">No providers yet.</p>
                  <p className="mt-1 text-stone-600">Add a staff member who takes appointments under <Link href={`/app/${slug}/staff`} className="text-brand-700 underline">Staff</Link>.</p>
                </>
              ) : (
                <>
                  <p className="font-medium text-stone-900">{service.name} is only assigned to people who no longer take appointments.</p>
                  <p className="mt-1 text-stone-600">Tick it for a provider under <Link href={`/app/${slug}/staff`} className="text-brand-700 underline">Staff → Services</Link>, or untick everyone so anyone can be booked for it.</p>
                </>
              )}
            </Card>
          ) : (
            <BookForm
              key={[service.id, ...extras.map((x) => x.id), anyMode ? "any" : staffId, date, location?.id ?? ""].join("|")}
              slug={slug}
              clientId={sp.clientId ?? ""}
              serviceId={service.id}
              extraServiceIds={extras.map((x) => x.id)}
              summary={`${chainLabel} · ${duration(mainTerms!.durationMin + service.gapMin + service.finishMin + chainMin)} · ${formatMoney(chainPrice, business.currency)}`}
              staffId={staffId}
              staffName={anyMode ? eligibleStaff[0]?.displayName : undefined}
              staffNames={Object.fromEntries(eligibleStaff.map((s) => [s.id, s.displayName]))}
              locationId={location?.id ?? null}
              date={date}
              dateLabel={formatDateLong(date)}
              slots={slots.map((d) => ({ iso: d.at.toISOString(), label: formatTime(d.at, tz), staffId: d.staffId }))}
              preselectIso={preselectTime ? (slots.find((d) => formatTime(d.at, tz) === formatTime(zonedToInstant(date, preselectTime, tz), tz))?.at.toISOString() ?? null) : null}
              customTimeDefault={preselectTime}
            />
          )}
        </div>
      </div>
    </>
  );
}
