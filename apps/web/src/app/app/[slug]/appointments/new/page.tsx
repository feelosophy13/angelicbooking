import type { Metadata } from "next";
import { asc, eq } from "drizzle-orm";

export const metadata: Metadata = { title: "New appointment" };
import { schema, withTenant } from "@angelic/db";
import { instantToISODate, zonedToInstant } from "@angelic/core";
import { requireAction } from "@/lib/tenant";
import { getStaffAvailability, staffForService, timingFor } from "@/server/availability";
import { formatDateLong, formatMoney, formatTime } from "@/lib/utils";
import { duration } from "@/lib/format";
import { Button, Card, Field, Input, Label, PageHeader, Select, Empty } from "@/components/ui";
import { BookForm } from "./book-form";
import { ClientPicker } from "@/components/client-picker";
import { quickCreateClient } from "../../clients/actions";
import { can } from "@angelic/core";
import { listLocations, servicesHiddenAt, tzFor } from "@/server/locations";

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
  const { business, permissions } = await requireAction(slug, "appointments.write.any");
  const locations = await listLocations(business.id);
  const multi = locations.length > 1;
  // Multi-site businesses pick the location first; it filters services, providers, open times and the clock shown.
  const location = multi ? (locations.find((l) => l.id === sp.location) ?? locations.find((l) => l.isDefault) ?? locations[0] ?? null) : null;
  const tz = tzFor(business, location);
  const date = /^\d{4}-\d{2}-\d{2}$/.test(sp.date ?? "") ? sp.date! : instantToISODate(new Date(), tz);

  const { services, client } = await withTenant(business.id, async (tx) => {
    const hidden = await servicesHiddenAt(tx, location?.id);
    return {
      services: (await tx.select().from(schema.services).where(eq(schema.services.active, true)).orderBy(asc(schema.services.name))).filter((s) => !hidden.has(s.id)),
      // Only the chosen client is loaded; the picker searches the rest as you type.
      client: sp.clientId ? await tx.query.clients.findFirst({ where: eq(schema.clients.id, sp.clientId), columns: { id: true, firstName: true, lastName: true } }) : null,
    };
  });

  const service = services.find((s) => s.id === sp.serviceId) ?? services[0] ?? null;
  // More services on the same visit, booked back to back with the same provider.
  const extraIds = (Array.isArray(sp.extra) ? sp.extra : sp.extra ? [sp.extra] : []).filter((id) => id && id !== service?.id);
  const extras = extraIds.map((id) => services.find((s) => s.id === id)).filter((s): s is NonNullable<typeof s> => !!s);
  const preselectTime = /^\d{2}:\d{2}$/.test(sp.time ?? "") ? sp.time! : null;
  const eligibleStaff = service ? await staffForService(business.id, service.id, location?.id) : [];
  const staffId = eligibleStaff.some((s) => s.id === sp.staffId) ? sp.staffId! : eligibleStaff[0]?.id;
  // Open times must fit the whole chain: the first service's timing plus every extra, end to end.
  const chainMin = extras.reduce((s, x) => s + x.durationMin + x.gapMin + x.finishMin + x.bufferAfterMin, 0);
  const slots =
    service && staffId
      ? await getStaffAvailability({
          businessId: business.id,
          timeZone: tz,
          slotIntervalMin: business.slotIntervalMin,
          staffId,
          date,
          service: chainMin > 0 ? { durationMin: service.durationMin + service.gapMin + service.finishMin + service.bufferAfterMin + chainMin, gapMin: 0, finishMin: 0, bufferAfterMin: 0 } : timingFor(service),
          notBefore: new Date(),
          locationId: location?.id,
        })
      : [];
  const chainPrice = (service?.priceCents ?? 0) + extras.reduce((s, x) => s + x.priceCents, 0);
  const chainLabel = service ? [service, ...extras].map((s) => s.name).join(" + ") : "";

  return (
    <>
      <PageHeader title="New appointment" />
      <div className="grid gap-6 lg:grid-cols-[360px_1fr]">
        <Card className="p-4">
          <form className="space-y-3">
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
            <Field label="Service">
              <Select name="serviceId" defaultValue={service?.id ?? ""} required>
                <option value="" disabled>Choose a service</option>
                {services.map((s) => (
                  <option key={s.id} value={s.id}>{s.name} · {duration(s.durationMin)} · {formatMoney(s.priceCents, business.currency)}</option>
                ))}
              </Select>
            </Field>
            {[...extras, null].map((x, i) => (
              <Field key={x?.id ?? "new"} label={i === 0 && !x ? "Add another service (optional)" : x ? `Also: ${x.name}` : "Add another service"}>
                <Select name="extra" defaultValue={x?.id ?? ""}>
                  <option value="">{x ? "Remove" : "None"}</option>
                  {services.filter((s) => s.id !== service?.id).map((s) => (
                    <option key={s.id} value={s.id}>{s.name} · {duration(s.durationMin)} · {formatMoney(s.priceCents, business.currency)}</option>
                  ))}
                </Select>
              </Field>
            ))}
            <Field label="Staff">
              <Select name="staffId" defaultValue={staffId ?? ""} disabled={!service}>
                {eligibleStaff.map((s) => (
                  <option key={s.id} value={s.id}>{s.displayName}</option>
                ))}
              </Select>
            </Field>
            <Field label="Date"><Input name="date" type="date" defaultValue={date} /></Field>
            <Button type="submit" variant="secondary" className="w-full">Find times</Button>
          </form>
        </Card>

        <div>
          {!service ? (
            <Empty title="Pick a service to see open times" />
          ) : !staffId ? (
            <Empty title="No staff can perform this service" body="Assign it on a staff member's page." />
          ) : (
            <BookForm
              slug={slug}
              clientId={sp.clientId ?? ""}
              serviceId={service.id}
              extraServiceIds={extras.map((x) => x.id)}
              summary={`${chainLabel} · ${duration(service.durationMin + service.gapMin + service.finishMin + chainMin)} · ${formatMoney(chainPrice, business.currency)}`}
              staffId={staffId}
              locationId={location?.id ?? null}
              date={date}
              dateLabel={formatDateLong(date)}
              slots={slots.map((d) => ({ iso: d.toISOString(), label: formatTime(d, tz) }))}
              preselectIso={preselectTime ? (slots.find((d) => formatTime(d, tz) === formatTime(zonedToInstant(date, preselectTime, tz), tz))?.toISOString() ?? null) : null}
              customTimeDefault={preselectTime}
            />
          )}
        </div>
      </div>
    </>
  );
}
