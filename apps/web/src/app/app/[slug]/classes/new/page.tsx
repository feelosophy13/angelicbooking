import type { Metadata } from "next";
import { instantToISODate } from "@angelic/core";
import { requireAnyAction } from "@/lib/tenant";
import { can } from "@angelic/core";
import { listGroupServices } from "@/server/classes";
import { getStaffAvailability, staffForService, timingFor } from "@/server/availability";
import { formatDateLong, formatTime } from "@/lib/utils";
import { duration } from "@/lib/format";
import { Button, Card, Field, Input, PageHeader, Select, Empty, BackLink } from "@/components/ui";
import { ScheduleClassForm } from "./form";

export const metadata: Metadata = { title: "Schedule a class" };

type SP = { date?: string; serviceId?: string; staffId?: string };

export default async function NewClassPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<SP> }) {
  const { slug } = await params;
  const sp = await searchParams;
  // "Run every class" picks any instructor; "Run their own classes" schedules only for themselves.
  const { business, permissions, staffId: myStaffId } = await requireAnyAction(slug, "classes.manage.any", "classes.manage.own");
  const ownOnly = !can(permissions, "classes.manage.any");
  const tz = business.timezone;
  const date = /^\d{4}-\d{2}-\d{2}$/.test(sp.date ?? "") ? sp.date! : instantToISODate(new Date(), tz);
  const services = await listGroupServices(business.id);
  const service = services.find((s) => s.id === sp.serviceId) ?? services[0] ?? null;
  const eligible = (service ? await staffForService(business.id, service.id) : []).filter((s) => !ownOnly || s.id === myStaffId);
  const staffId = eligible.some((s) => s.id === sp.staffId) ? sp.staffId! : eligible[0]?.id;
  const slots = service && staffId ? await getStaffAvailability({ businessId: business.id, timeZone: tz, slotIntervalMin: business.slotIntervalMin, staffId, date, service: timingFor(service), notBefore: new Date() }) : [];
  return (
    <>
      <div className="mb-2"><BackLink href={`/app/${slug}/classes`}>Classes</BackLink></div>
      <PageHeader title="Schedule a class" />
      {services.length === 0 ? (
        <Empty title="No group services yet" body="Set a group size above 1 on a service first." action={{ href: `/app/${slug}/services`, label: "Services" }} />
      ) : (
        <div className="grid gap-6 lg:grid-cols-[360px_1fr]">
          <Card className="p-4">
            <form className="space-y-3">
              <Field label="Class">
                <Select name="serviceId" defaultValue={service?.id ?? ""}>
                  {services.map((s) => <option key={s.id} value={s.id}>{s.name} · {duration(s.durationMin + s.gapMin + s.finishMin)} · up to {s.capacity}</option>)}
                </Select>
              </Field>
              {eligible.length > 1 ? (
                <Field label="Instructor">
                  <Select name="staffId" defaultValue={staffId ?? ""}>
                    {eligible.map((s) => <option key={s.id} value={s.id}>{s.displayName}</option>)}
                  </Select>
                </Field>
              ) : eligible[0] ? <p className="text-sm text-stone-600">Instructor: {eligible[0].displayName}</p> : null}
              <Field label="Date"><Input name="date" type="date" defaultValue={date} /></Field>
              <Button type="submit" variant="secondary" className="w-full">Find times</Button>
            </form>
          </Card>
          <div>
            {!service || !staffId ? (
              <Empty title="No instructor can run this class" body="Assign the service on a staff member's Services tab." />
            ) : slots.length === 0 ? (
              <Empty title={`No open times on ${formatDateLong(date)}`} body="Try another day or instructor." />
            ) : (
              <ScheduleClassForm slug={slug} serviceId={service.id} staffId={staffId} defaultCapacity={service.capacity} dateLabel={formatDateLong(date)} slots={slots.map((d) => ({ iso: d.toISOString(), label: formatTime(d, tz) }))} />
            )}
          </div>
        </div>
      )}
    </>
  );
}
