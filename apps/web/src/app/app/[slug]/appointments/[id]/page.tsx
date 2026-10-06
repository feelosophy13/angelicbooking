import Link from "next/link";
import { notFound } from "next/navigation";
import { instantToISODate } from "@angelic/core";
import { requireAction } from "@/lib/tenant";
import { getAppointmentDetail } from "@/server/appointments";
import { getStaffAvailability, timingFor } from "@/server/availability";
import { formatDateLong, formatMoney, formatTime } from "@/lib/utils";
import { Button, Card, Field, Input, PageHeader, Select, Textarea } from "@/components/ui";
import { addService, changeStatus, moveService, removeService, saveNotes, startCheckout } from "./actions";
import { eq } from "drizzle-orm";
import { schema, withTenant } from "@angelic/db";
import { SlotPickerForm } from "./slot-picker-form";

const STATUS_LABEL: Record<string, string> = {
  booked: "Booked",
  confirmed: "Confirmed",
  checked_in: "Checked in",
  in_progress: "In progress",
  completed: "Completed",
  no_show: "No-show",
  cancelled: "Cancelled",
};

type SP = { addServiceId?: string; addStaffId?: string; addDate?: string; moveItemId?: string; moveStaffId?: string; moveDate?: string };

export default async function AppointmentPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string; id: string }>;
  searchParams: Promise<SP>;
}) {
  const { slug, id } = await params;
  const sp = await searchParams;
  const { business, user } = await requireAction(slug, "appointments.read.any");
  const data = await getAppointmentDetail(business.id, id);
  if (!data) notFound();
  const { appointment, items, client, services, staff } = data;
  const existingSale = await withTenant(business.id, (tx) => tx.query.sales.findFirst({ where: eq(schema.sales.appointmentId, id) }));
  const tz = business.timezone;
  const live = items.filter((i) => i.status !== "cancelled");
  const first = live[0] ?? items[0];
  const apptDate = first ? instantToISODate(first.startAt, tz) : instantToISODate(new Date(), tz);
  const lastEnd = live.reduce<Date | null>((m, i) => (!m || i.endAt > m ? i.endAt : m), null);
  const total = live.reduce((s, i) => s + i.priceCents, 0);
  const locked = ["completed", "cancelled", "no_show"].includes(appointment.status);
  const self = `/app/${slug}/appointments/${id}`;

  // Group segments by service so colour + finish show as one line.
  const groups = new Map<string, typeof items>();
  for (const i of items) {
    const k = `${i.serviceId ?? i.id}:${i.staffId}`;
    groups.set(k, [...(groups.get(k) ?? []), i]);
  }

  // --- Add service panel state (driven by query string so it stays a server page)
  const addSvc = services.find((s) => s.id === sp.addServiceId) ?? null;
  const addStaffId = staff.some((s) => s.id === sp.addStaffId) ? sp.addStaffId! : (first?.staffId ?? staff[0]?.id);
  const addDate = /^\d{4}-\d{2}-\d{2}$/.test(sp.addDate ?? "") ? sp.addDate! : apptDate;
  const addSlots =
    addSvc && addStaffId
      ? await getStaffAvailability({
          businessId: business.id,
          timeZone: tz,
          slotIntervalMin: business.slotIntervalMin,
          staffId: addStaffId,
          date: addDate,
          service: timingFor(addSvc),
          notBefore: new Date(),
        })
      : [];
  const preferredIdx = lastEnd ? addSlots.findIndex((d) => d >= lastEnd) : 0;
  const addSlotsOrdered = preferredIdx > 0 ? [...addSlots.slice(preferredIdx), ...addSlots.slice(0, preferredIdx)] : addSlots;

  // --- Move service panel state
  const moveItem = items.find((i) => i.id === sp.moveItemId && i.status !== "cancelled") ?? null;
  const moveSvc = moveItem ? services.find((s) => s.id === moveItem.serviceId) ?? null : null;
  const moveStaffId = staff.some((s) => s.id === sp.moveStaffId) ? sp.moveStaffId! : moveItem?.staffId;
  const moveDate = /^\d{4}-\d{2}-\d{2}$/.test(sp.moveDate ?? "") ? sp.moveDate! : apptDate;
  const moveSlots =
    moveItem && moveSvc && moveStaffId
      ? await getStaffAvailability({
          businessId: business.id,
          timeZone: tz,
          slotIntervalMin: business.slotIntervalMin,
          staffId: moveStaffId,
          date: moveDate,
          service: timingFor(moveSvc),
          notBefore: new Date(),
        })
      : [];

  return (
    <>
      <PageHeader title={client ? `${client.firstName} ${client.lastName}`.trim() : "Walk-in"}>
        <Link href={`/app/${slug}?date=${apptDate}`} className="text-sm text-brand-700 underline">← Calendar</Link>
      </PageHeader>

      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        <div className="space-y-6">
          <Card className="p-4">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="text-sm text-stone-500">{formatDateLong(apptDate)}</p>
                <p className="text-lg font-semibold">{STATUS_LABEL[appointment.status]}</p>
              </div>
              <p className="text-lg font-semibold">{formatMoney(total, business.currency)}</p>
            </div>
            <ul className="divide-y divide-stone-200">
              {[...groups.values()].map((segs) => {
                const head = segs[0]!;
                const start = segs.reduce((a, b) => (a.startAt < b.startAt ? a : b)).startAt;
                const end = segs.reduce((a, b) => (a.endAt > b.endAt ? a : b)).endAt;
                const cancelled = head.status === "cancelled";
                return (
                  <li key={head.id} className={`flex flex-wrap items-center gap-3 py-3 ${cancelled ? "opacity-50 line-through" : ""}`}>
                    <span className="h-3 w-3 rounded-full" style={{ background: head.staffColor }} />
                    <div className="min-w-0 flex-1">
                      <p className="font-medium">{head.serviceName.replace(" (finish)", "")}</p>
                      <p className="text-xs text-stone-500">
                        {formatTime(start, tz)} – {formatTime(end, tz)} · {head.staffName}
                        {segs.length > 1 ? " · includes processing time" : ""}
                      </p>
                    </div>
                    <span className="text-sm">{formatMoney(segs.reduce((s, i) => s + i.priceCents, 0), business.currency)}</span>
                    {!locked && !cancelled ? (
                      <div className="flex gap-1">
                        <Link href={`${self}?moveItemId=${head.id}`} className="rounded-md px-2 py-1 text-xs text-stone-700 hover:bg-stone-100">Move</Link>
                        <form action={removeService}>
                          <input type="hidden" name="slug" value={slug} />
                          <input type="hidden" name="appointmentId" value={id} />
                          <input type="hidden" name="itemId" value={head.id} />
                          <button className="rounded-md px-2 py-1 text-xs text-red-700 hover:bg-red-50">Remove</button>
                        </form>
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </Card>

          {moveItem ? (
            <Card className="p-4">
              <h2 className="mb-1 font-medium">Move {moveItem.serviceName.replace(" (finish)", "")}</h2>
              <form className="mb-3 grid grid-cols-[1fr_1fr_auto] items-end gap-2">
                <input type="hidden" name="moveItemId" value={moveItem.id} />
                <Field label="Staff">
                  <Select name="moveStaffId" defaultValue={moveStaffId}>
                    {staff.map((s) => <option key={s.id} value={s.id}>{s.displayName}</option>)}
                  </Select>
                </Field>
                <Field label="Date"><Input type="date" name="moveDate" defaultValue={moveDate} /></Field>
                <Button type="submit" variant="secondary">Find times</Button>
              </form>
              <SlotPickerForm
                action={moveService}
                hidden={{ slug, appointmentId: id, itemId: moveItem.id, staffId: moveStaffId ?? moveItem.staffId }}
                slots={moveSlots.map((d) => ({ iso: d.toISOString(), label: formatTime(d, tz) }))}
                submitLabel="Move here"
                emptyText="No openings for that day. Try another date or staff member."
              />
              <Link href={self} className="mt-3 inline-block text-xs text-stone-500 underline">Cancel</Link>
            </Card>
          ) : null}

          {!locked ? (
            <Card className="p-4">
              <h2 className="mb-3 font-medium">Add a service</h2>
              <form className="mb-3 grid grid-cols-[2fr_1fr_1fr_auto] items-end gap-2">
                <Field label="Service">
                  <Select name="addServiceId" defaultValue={addSvc?.id ?? ""} required>
                    <option value="" disabled>Choose</option>
                    {services.map((s) => <option key={s.id} value={s.id}>{s.name} · {s.durationMin} min</option>)}
                  </Select>
                </Field>
                <Field label="Staff">
                  <Select name="addStaffId" defaultValue={addStaffId}>
                    {staff.map((s) => <option key={s.id} value={s.id}>{s.displayName}</option>)}
                  </Select>
                </Field>
                <Field label="Date"><Input type="date" name="addDate" defaultValue={addDate} /></Field>
                <Button type="submit" variant="secondary">Find times</Button>
              </form>
              {addSvc && addStaffId ? (
                <SlotPickerForm
                  action={addService}
                  hidden={{ slug, appointmentId: id, serviceId: addSvc.id, staffId: addStaffId }}
                  slots={addSlotsOrdered.map((d) => ({ iso: d.toISOString(), label: formatTime(d, tz) }))}
                  submitLabel={`Add ${addSvc.name}`}
                  emptyText="No openings for that day."
                />
              ) : (
                <p className="text-sm text-stone-500">Times right after the current services are listed first.</p>
              )}
            </Card>
          ) : null}

          <Card className="p-4">
            <h2 className="mb-2 font-medium">Notes</h2>
            <form action={saveNotes} className="space-y-2">
              <input type="hidden" name="slug" value={slug} />
              <input type="hidden" name="appointmentId" value={id} />
              <Textarea name="notes" rows={3} defaultValue={appointment.notes ?? ""} placeholder="Anything the team should know for this visit" />
              <Button type="submit" size="sm" variant="secondary">Save notes</Button>
            </form>
          </Card>
        </div>

        <div className="space-y-6">
          <Card className="p-4">
            <h2 className="mb-2 font-medium">Checkout</h2>
            {existingSale ? (
              <Link href={`/app/${slug}/sales/${existingSale.id}`} className="inline-flex h-10 w-full items-center justify-center rounded-lg bg-brand-600 px-4 text-sm font-medium text-white hover:bg-brand-700">
                {existingSale.status === "open" ? `Continue checkout (#${existingSale.number})` : `View sale #${existingSale.number}`}
              </Link>
            ) : appointment.status !== "cancelled" ? (
              <form action={startCheckout}>
                <input type="hidden" name="slug" value={slug} />
                <input type="hidden" name="appointmentId" value={id} />
                <Button type="submit" className="w-full">Check out · {formatMoney(total, business.currency)}</Button>
              </form>
            ) : (
              <p className="text-sm text-stone-500">Cancelled appointments can&apos;t be checked out.</p>
            )}
          </Card>

          <Card className="p-4">
            <h2 className="mb-3 font-medium">Status</h2>
            <form action={changeStatus} className="flex flex-wrap gap-1.5">
              <input type="hidden" name="slug" value={slug} />
              <input type="hidden" name="appointmentId" value={id} />
              {(["confirmed", "checked_in", "in_progress", "completed", "no_show"] as const)
                .filter((s) => s !== appointment.status)
                .map((s) => (
                  <Button key={s} name="status" value={s} size="sm" variant="secondary" type="submit" disabled={appointment.status === "cancelled"}>
                    {STATUS_LABEL[s]}
                  </Button>
                ))}
            </form>
            {appointment.status !== "cancelled" ? (
              <form action={changeStatus} className="mt-4 space-y-2 border-t border-stone-200 pt-3">
                <input type="hidden" name="slug" value={slug} />
                <input type="hidden" name="appointmentId" value={id} />
                <input type="hidden" name="status" value="cancelled" />
                <Input name="reason" placeholder="Cancellation reason (optional)" />
                <Button size="sm" variant="danger" type="submit" className="w-full">Cancel appointment</Button>
              </form>
            ) : (
              <p className="mt-3 text-sm text-stone-500">
                Cancelled{appointment.cancellationReason ? `: ${appointment.cancellationReason}` : ""}.
              </p>
            )}
          </Card>

          <Card className="p-4">
            <h2 className="mb-2 font-medium">Client</h2>
            {client ? (
              <div className="space-y-1 text-sm">
                <p className="font-medium">{client.firstName} {client.lastName}</p>
                {client.phone ? <p className="text-stone-600">{client.phone}</p> : null}
                {client.email ? <p className="text-stone-600">{client.email}</p> : null}
                {client.notes ? <p className="mt-2 rounded-md bg-amber-50 p-2 text-xs text-amber-900">{client.notes}</p> : null}
              </div>
            ) : (
              <p className="text-sm text-stone-500">No client attached.</p>
            )}
          </Card>

          <p className="text-xs text-stone-400">
            Booked via {appointment.source} · created {new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: tz }).format(appointment.createdAt)}
            {appointment.createdByUserId === user.id ? " by you" : ""}
          </p>
        </div>
      </div>
    </>
  );
}
