import { asc, eq } from "drizzle-orm";
import { schema, withTenant } from "@angelic/db";
import { instantToISODate } from "@angelic/core";
import { requireAction } from "@/lib/tenant";
import { getStaffAvailability, staffForService, timingFor } from "@/server/availability";
import { formatDateLong, formatMoney, formatTime } from "@/lib/utils";
import { Button, Card, Field, Input, PageHeader, Select, Empty } from "@/components/ui";
import { BookForm } from "./book-form";

type SP = { date?: string; serviceId?: string; staffId?: string; clientId?: string };

export default async function NewAppointmentPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<SP>;
}) {
  const { slug } = await params;
  const sp = await searchParams;
  const { business } = await requireAction(slug, "appointments.write.any");
  const tz = business.timezone;
  const date = /^\d{4}-\d{2}-\d{2}$/.test(sp.date ?? "") ? sp.date! : instantToISODate(new Date(), tz);

  const { services, clients } = await withTenant(business.id, async (tx) => ({
    services: await tx.select().from(schema.services).where(eq(schema.services.active, true)).orderBy(asc(schema.services.name)),
    clients: await tx.select().from(schema.clients).orderBy(asc(schema.clients.lastName), asc(schema.clients.firstName)).limit(500),
  }));

  const service = services.find((s) => s.id === sp.serviceId) ?? null;
  const eligibleStaff = service ? await staffForService(business.id, service.id) : [];
  const staffId = eligibleStaff.some((s) => s.id === sp.staffId) ? sp.staffId! : eligibleStaff[0]?.id;
  const slots =
    service && staffId
      ? await getStaffAvailability({
          businessId: business.id,
          timeZone: tz,
          slotIntervalMin: business.slotIntervalMin,
          staffId,
          date,
          service: timingFor(service),
          notBefore: new Date(),
        })
      : [];

  return (
    <>
      <PageHeader title="New appointment" />
      <div className="grid gap-6 lg:grid-cols-[360px_1fr]">
        <Card className="p-4">
          <form className="space-y-3">
            <Field label="Client">
              <Select name="clientId" defaultValue={sp.clientId ?? ""}>
                <option value="">Walk-in / no client</option>
                {clients.map((c) => (
                  <option key={c.id} value={c.id}>{c.firstName} {c.lastName}{c.phone ? ` · ${c.phone}` : ""}</option>
                ))}
              </Select>
            </Field>
            <Field label="Service">
              <Select name="serviceId" defaultValue={service?.id ?? ""} required>
                <option value="" disabled>Choose a service</option>
                {services.map((s) => (
                  <option key={s.id} value={s.id}>{s.name} · {s.durationMin} min · {formatMoney(s.priceCents, business.currency)}</option>
                ))}
              </Select>
            </Field>
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
          ) : slots.length === 0 ? (
            <Empty title={`No openings on ${formatDateLong(date)}`} body="Try another day or staff member." />
          ) : (
            <BookForm
              slug={slug}
              clientId={sp.clientId ?? ""}
              serviceId={service.id}
              staffId={staffId}
              dateLabel={formatDateLong(date)}
              slots={slots.map((d) => ({ iso: d.toISOString(), label: formatTime(d, tz) }))}
            />
          )}
        </div>
      </div>
    </>
  );
}
