import Link from "next/link";
import type { Metadata } from "next";
import { StatusBadge } from "@/components/status-badge";
import { rowClass, RowLink } from "@/components/row";
import { Disclosure } from "@/components/disclosure";
import { ActivityTrail } from "@/components/activity-trail";
import { appointmentActivity } from "@/server/activity";
import { ConfirmSubmit } from "@/components/form";
import { notFound } from "next/navigation";
import { instantToISODate, isInsideCancelWindow, lateCancelFee } from "@angelic/core";
import { requireAppointmentAccess } from "@/server/appointment-access";
import { bookingAccess, coversLine } from "@/lib/appointment-access";
import { canSeeClientContact } from "@/lib/visibility";
import { getAppointmentDetail } from "@/server/appointments";
import { getStaffAvailability } from "@/server/availability";
import { timingForStaff } from "@/server/stylist-pricing";
import { formatDateLong, formatMoney, formatTime, shiftISODate } from "@/lib/utils";
import { BackLink, Button, Card, Field, Input, PageHeader, Select, Textarea, LinkButton } from "@/components/ui";
import { addService, cancelSeries, changeStatus, moveService, refundDepositAction, removeService, saveNotes, startCheckout, startGroupCheckout } from "./actions";
import { getSeriesForAppointment } from "@/server/series";
import { formsForAppointment } from "@/server/forms";
import { appUrl } from "@/lib/stripe";
import { can } from "@angelic/core";
import { and, asc, desc, eq, inArray, ne } from "drizzle-orm";
import { schema, withTenant } from "@angelic/db";
import { SlotPickerForm } from "./slot-picker-form";
import { ServicePicker } from "@/components/service-picker";
import { serviceGroups } from "@/server/service-groups";
import { NoShowFeeForm } from "./no-show-form";
import { listCancellationReasons } from "@/server/cancellation-reasons";
import { CancelForm } from "./cancel-form";
import { VisitPhotosCard, type PhotoGroup } from "./visit-photos-card";
import { SuppliesCard } from "./supplies-card";
import { LashMapEyes } from "@/components/lash-map";
import { canWriteLashMaps, lashMapsFor } from "@/server/lash-maps";
import { pairsForAppointment, photoTagsInUse } from "@/server/visit-photos";
import { savedCardsForClient } from "@/server/card-on-file";
import { listLocations, paymentContextForAppointment, tzFor } from "@/server/locations";
import { MapPin, CalendarPlus } from "lucide-react";
import { canChartClient, chartsForAppointment } from "@/server/charts";
import { ChartStatusBadge } from "../../charts/parts";

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

export async function generateMetadata({ params }: { params: Promise<{ slug: string; id: string }> }): Promise<Metadata> {
  const { slug, id } = await params;
  const { business } = await requireAppointmentAccess(slug, id, "read").catch(() => ({ business: null }));
  if (!business) return { title: "Appointment" };
  const d = await getAppointmentDetail(business.id, id);
  if (d?.appointment.kind === "block") return { title: "Blocked time" };
  const name = d?.client ? `${d.client.firstName} ${d.client.lastName}`.trim() : "Walk-in";
  return { title: d ? `${name} · Appointment` : "Appointment" };
}

export default async function AppointmentPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string; id: string }>;
  searchParams: Promise<SP>;
}) {
  const { slug, id } = await params;
  const sp = await searchParams;
  // Front desk and managers open any appointment; a Provider opens the ones they are booked on.
  const { business, user, permissions, access, staffId } = await requireAppointmentAccess(slug, id, "read");
  const data = await getAppointmentDetail(business.id, id);
  if (!data) notFound();
  const canWriteAny = can(permissions, "appointments.write.any");
  // What a Provider may do to their own appointment: status, notes, photos and checkout. Changing the booking itself (services, moves, series, cancelling) stays with the desk.
  // On a visit shared with a colleague ("shared" access) the status reaches the colleague's lines too, so only notes, photos, supplies and
  // checkout stay open, and the booking controls work on their own lines alone.
  const mine = access !== "any";
  const canEdit = canWriteAny || (access === "own" && can(permissions, "appointments.write.own"));
  const canNote = canWriteAny || (mine && can(permissions, "appointments.write.own"));
  // The owner decides whether a Provider may also change the booking itself, cancel it, or book more.
  const canChange = canWriteAny || (mine && can(permissions, "appointments.change.own"));
  const canCancel = canWriteAny || (access === "own" && can(permissions, "appointments.cancel.own"));
  const canBook = !!bookingAccess(permissions, staffId ?? null);
  // Someone working their own calendar can only add or move services onto themselves, so there is no one to choose.
  const ownStaff = mine ? (staffId ?? null) : null;
  const canCheckout = canNote && can(permissions, "checkout.take");
  const canFillForms = can(permissions, "clients.write");
  const { appointment, items, client, services, staff } = data;
  const ownSale = await withTenant(business.id, (tx) => tx.query.sales.findFirst({ where: and(eq(schema.sales.appointmentId, id), ne(schema.sales.status, "void")), orderBy: desc(schema.sales.createdAt) }));
  // Booked together online (the client and their guests): everyone side by side, and a shared ticket if they were checked out together.
  const group = appointment.groupId ? await groupMembers(business.id, appointment.groupId) : [];
  const existingSale = ownSale ?? (group.length ? group.find((g) => g.id === id)?.sale ?? null : null);
  // The rating request for this visit, if one went out: submitted or still waiting.
  const review = await withTenant(business.id, (tx) => tx.query.reviews.findFirst({ where: eq(schema.reviews.appointmentId, id), orderBy: desc(schema.reviews.requestedAt) }));
  const cancelReasonName = appointment.cancellationReasonId ? ((await listCancellationReasons(business.id, { includeRetired: true })).find((r) => r.id === appointment.cancellationReasonId)?.name ?? null) : null;
  const activity = await appointmentActivity(business, id);
  const fmtDay = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeZone: business.timezone });
  // The client's contact details and private notes follow the client permissions (C1, C2), not the appointment's.
  const canContact = canSeeClientContact(permissions);
  const canClientNotes = can(permissions, "clients.notes");
  const pinnedNotes = client && canClientNotes ? await withTenant(business.id, (tx) => tx.select().from(schema.clientNotes).where(eq(schema.clientNotes.clientId, client.id)).orderBy(desc(schema.clientNotes.pinned), desc(schema.clientNotes.createdAt)).limit(3)) : [];
  // The client's latest lash map, on any visit where they have one or a lash service is booked.
  const lash = client && appointment.kind === "visit" ? await withTenant(business.id, async (tx) => ({ map: (await lashMapsFor(tx, client.id, 1))[0] ?? null, write: await canWriteLashMaps(tx, { permissions, staffId }, client.id) })) : null;
  const showLash = !!lash && (!!lash.map || (lash.write && items.some((i) => /lash/i.test(i.serviceName))));
  // Treatment charts for this visit: only for someone who may read this client's charts (never implied by the appointment permissions).
  const charts = client && appointment.kind === "visit" ? await withTenant(business.id, async (tx) => (await canChartClient(tx, { permissions, staffId }, client.id, "read")) ? { rows: await chartsForAppointment(tx, id), write: await canChartClient(tx, { permissions, staffId }, client.id, "write") } : null) : null;
  const series = appointment.seriesId ? await getSeriesForAppointment(business.id, id) : null;
  const forms = await withTenant(business.id, (tx) => formsForAppointment(tx, id));
  const pay = await paymentContextForAppointment(business, id);
  const multiLocation = (await listLocations(business.id)).length > 1;
  const stripeReady = pay.ready;
  const savedCards = await savedCardsForClient(business, pay, client?.id);
  const tz = tzFor(business, pay.location);
  const addGroups = await serviceGroups(business); // searchable, by category, for "Add a service"
  // One group of photos per service-and-stylist on the visit.
  const photoGroups: PhotoGroup[] = [];
  for (const it of items) if (!photoGroups.some((g) => g.serviceId === it.serviceId && g.staffId === it.staffId)) photoGroups.push({ serviceId: it.serviceId, staffId: it.staffId, serviceName: it.serviceName.replace(/ \(finish\)$/, ""), staffName: it.staffName });
  const [photoPairs, photoTags] = appointment.kind === "visit" ? await Promise.all([pairsForAppointment(business.id, id), photoTagsInUse(business.id)]) : [[], []];
  const live = items.filter((i) => i.status !== "cancelled");
  const first = live[0] ?? items[0];
  const apptDate = first ? instantToISODate(first.startAt, tz) : instantToISODate(new Date(), tz);
  const lastEnd = live.reduce<Date | null>((m, i) => (!m || i.endAt > m ? i.endAt : m), null);
  const total = live.reduce((s, i) => s + i.priceCents, 0);
  const locked = ["completed", "cancelled", "no_show"].includes(appointment.status);
  const self = `/app/${slug}/appointments/${id}`;
  // A cancelled visit stays cancelled, so no status buttons for it; everything else needs the update permission.
  const showStatusButtons = canEdit && appointment.status !== "cancelled";
  const showCancel = canCancel && appointment.status !== "cancelled";
  const showNoShowFee = !locked && !existingSale && savedCards.length > 0 && canCancel;
  // What a late cancellation would cost right now, for the cancel form.
  const latePolicy = { feeType: business.lateCancelFeeType as "none" | "flat" | "percent", feeValue: business.lateCancelFeeValue, deposit: business.lateCancelDeposit as "toward" | "extra" };
  const lateFee = first && latePolicy.feeType !== "none" && !locked && appointment.kind !== "block" && isInsideCancelWindow(first.startAt, business.cancelWindowHours) ? lateCancelFee(latePolicy, total, appointment.depositStatus === "paid" ? appointment.depositCents : 0) : null;
  const lateCancel = lateFee && lateFee.feeCents > 0 ? { feeLabel: formatMoney(lateFee.feeCents, business.currency), depositCoversLabel: lateFee.depositCoversCents > 0 ? formatMoney(lateFee.depositCoversCents, business.currency) : null, chargeLabel: lateFee.chargeCents > 0 ? formatMoney(lateFee.chargeCents, business.currency) : null, chargeCents: lateFee.chargeCents } : null;

  // A paid deposit: when staff cancel, what to do with it. Inside the window the fee the deposit covers can be kept and the rest returned; outside it (or when the salon cancels) all of it goes back.
  const depositPaid = appointment.depositStatus === "paid" ? appointment.depositCents : 0;
  const insideWindow = !!first && isInsideCancelWindow(first.startAt, business.cancelWindowHours);
  const depositExcess = lateFee && latePolicy.deposit === "toward" ? depositPaid - lateFee.depositCoversCents : 0;
  const canRefundDeposit = can(permissions, "checkout.refund");
  const depositChoice = depositPaid > 0 && !locked && appointment.kind !== "block"
    ? {
        totalLabel: formatMoney(depositPaid, business.currency),
        feeOnly: depositExcess > 0 && lateFee ? { keepLabel: formatMoney(lateFee.depositCoversCents, business.currency), refundLabel: formatMoney(depositExcess, business.currency) } : null,
        canRefund: canRefundDeposit,
        defaultChoice: (!canRefundDeposit ? "keep" : !insideWindow ? "refund_all" : depositExcess > 0 ? "fee_only" : "keep") as "keep" | "fee_only" | "refund_all",
      }
    : null;

  // Group segments by service so colour + finish show as one line.
  const groups = new Map<string, typeof items>();
  for (const i of items) {
    const k = `${i.serviceId ?? i.id}:${i.staffId}`;
    groups.set(k, [...(groups.get(k) ?? []), i]);
  }

  // --- Add service panel state (driven by query string so it stays a server page)
  const addSvc = services.find((s) => s.id === sp.addServiceId) ?? null;
  const addStaffId = ownStaff ?? (staff.some((s) => s.id === sp.addStaffId) ? sp.addStaffId! : (first?.staffId ?? staff[0]?.id));
  const addDate = /^\d{4}-\d{2}-\d{2}$/.test(sp.addDate ?? "") ? sp.addDate! : apptDate;
  const addSlots =
    addSvc && addStaffId
      ? await getStaffAvailability({
          businessId: business.id,
          timeZone: tz,
          slotIntervalMin: business.slotIntervalMin,
          staffId: addStaffId,
          date: addDate,
          service: await timingForStaff(business.id, addSvc, addStaffId),
          notBefore: new Date(),
        })
      : [];
  const preferredIdx = lastEnd ? addSlots.findIndex((d) => d >= lastEnd) : 0;
  const addSlotsOrdered = preferredIdx > 0 ? [...addSlots.slice(preferredIdx), ...addSlots.slice(0, preferredIdx)] : addSlots;

  // --- Move service panel state
  const moveItem = items.find((i) => i.id === sp.moveItemId && i.status !== "cancelled") ?? null;
  const moveSvc = moveItem ? services.find((s) => s.id === moveItem.serviceId) ?? null : null;
  const moveStaffId = ownStaff ?? (staff.some((s) => s.id === sp.moveStaffId) ? sp.moveStaffId! : moveItem?.staffId);
  const moveDate = /^\d{4}-\d{2}-\d{2}$/.test(sp.moveDate ?? "") ? sp.moveDate! : apptDate;
  const moveSlots =
    moveItem && moveSvc && moveStaffId
      ? await getStaffAvailability({
          businessId: business.id,
          timeZone: tz,
          slotIntervalMin: business.slotIntervalMin,
          staffId: moveStaffId,
          date: moveDate,
          service: await timingForStaff(business.id, moveSvc, moveStaffId),
          notBefore: new Date(),
        })
      : [];

  if (appointment.kind === "block") {
    const blockItem = items[0];
    const canRemoveBlock = canWriteAny || (access === "own" && can(permissions, "appointments.block.own"));
    return (
      <>
        <div className="mb-2"><BackLink href={`/app/${slug}?date=${apptDate}`}>Calendar</BackLink></div>
        <PageHeader title="Blocked time" />
        <Card className="max-w-lg p-4 text-sm">
          <p className="font-medium">{appointment.notes || "Blocked time"}</p>
          {blockItem ? <p className="text-stone-600">{staff.find((s) => s.id === blockItem.staffId)?.displayName} · {formatDateLong(apptDate)} · {formatTime(blockItem.startAt, tz)} – {formatTime(blockItem.endAt, tz)}</p> : null}
          {appointment.status === "cancelled" ? <p className="mt-2 text-stone-500">This block was removed.</p> : canRemoveBlock ? (
            <form action={changeStatus} className="mt-3">
              <input type="hidden" name="slug" value={slug} />
              <input type="hidden" name="appointmentId" value={id} />
              <input type="hidden" name="status" value="cancelled" />
              <Button type="submit" variant="secondary">Remove block</Button>
            </form>
          ) : null}
          {appointment.status !== "cancelled" && canRemoveBlock ? <p className="mt-3 text-xs text-stone-500">Drag the block on the calendar to move it.</p> : null}
        </Card>
      </>
    );
  }

  return (
    <>
      <div className="mb-2"><BackLink href={`/app/${slug}?date=${apptDate}`}>Calendar</BackLink></div>
      <PageHeader title={client ? `${client.firstName} ${client.lastName}`.trim() : "Walk-in"}>
        {client && first && canBook ? (
          <LinkButton
            href={`/app/${slug}/appointments/new?clientId=${client.id}${first.serviceId ? `&serviceId=${first.serviceId}` : ""}&staffId=${first.staffId}&date=${shiftISODate(apptDate, 28)}${multiLocation && pay.location ? `&location=${pay.location.id}` : ""}`}
            variant="secondary"
            size="sm"
            title="Book this client's next visit (same service and provider, four weeks out)"
          >
            <CalendarPlus className="h-4 w-4" /> Rebook
          </LinkButton>
        ) : null}
      </PageHeader>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_300px] xl:grid-cols-[1fr_360px]">
        <div className="space-y-6">
          <Card className="p-4">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="text-sm text-stone-500">{formatDateLong(apptDate)}{multiLocation && pay.location ? <> · <MapPin className="inline h-3.5 w-3.5 align-text-bottom" /> {pay.location.name}</> : null}</p>
                <StatusBadge status={appointment.status} className="mt-1 text-sm" />
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
                    {!locked && !cancelled && canChange && coversLine(access, staffId ?? null, head.staffId) ? (
                      <div className="flex gap-1">
                        <LinkButton href={`${self}?moveItemId=${head.id}`} variant="ghost" size="sm">Move</LinkButton>
                        <form action={removeService}>
                          <input type="hidden" name="slug" value={slug} />
                          <input type="hidden" name="appointmentId" value={id} />
                          <input type="hidden" name="itemId" value={head.id} />
                          <ConfirmSubmit title={`Remove ${head.serviceName.replace(" (finish)", "")}?`} body="The time is freed on the calendar. If it was the only service, the appointment is cancelled." confirmLabel="Remove" variant="ghost" className="text-red-700">Remove</ConfirmSubmit>
                        </form>
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </Card>

          {moveItem && canChange && coversLine(access, staffId ?? null, moveItem.staffId) ? (
            <Card className="p-4 ring-2 ring-brand-200">
              <h2 className="mb-1 font-medium">Move {moveItem.serviceName.replace(" (finish)", "")}</h2>
              <form className={`mb-3 grid items-end gap-2 ${ownStaff ? "grid-cols-[1fr_auto]" : "sm:grid-cols-[1fr_1fr_auto]"}`}>
                <input type="hidden" name="moveItemId" value={moveItem.id} />
                {ownStaff ? <input type="hidden" name="moveStaffId" value={ownStaff} /> : (
                  <Field label="Staff">
                    <Select name="moveStaffId" defaultValue={moveStaffId}>
                      {staff.map((s) => <option key={s.id} value={s.id}>{s.displayName}</option>)}
                    </Select>
                  </Field>
                )}
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

          {!locked && canChange ? (
            <Disclosure title="Add a service" hint="another service on this visit" open={!!addSvc}>
              <form className={`mb-3 grid items-end gap-2 ${ownStaff ? "sm:grid-cols-[2fr_1fr_auto]" : "sm:grid-cols-[2fr_1fr_1fr_auto]"}`}>
                <Field label="Service">
                  <ServicePicker name="addServiceId" groups={addGroups} value={addSvc?.id ?? null} placeholder="Choose a service" />
                </Field>
                {ownStaff ? <input type="hidden" name="addStaffId" value={ownStaff} /> : (
                  <Field label="Staff">
                    <Select name="addStaffId" defaultValue={addStaffId}>
                      {staff.map((s) => <option key={s.id} value={s.id}>{s.displayName}</option>)}
                    </Select>
                  </Field>
                )}
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
            </Disclosure>
          ) : null}

          <Card className="p-4">
            <h2 className="mb-2 font-medium">Notes</h2>
            {canNote ? (
              <form action={saveNotes} className="space-y-2">
                <input type="hidden" name="slug" value={slug} />
                <input type="hidden" name="appointmentId" value={id} />
                <Textarea name="notes" rows={5} defaultValue={appointment.notes ?? ""} placeholder="Anything the team should know for this visit" />
                <Button type="submit" size="sm" variant="secondary">Save notes</Button>
              </form>
            ) : appointment.notes ? <p className="whitespace-pre-line text-sm text-stone-700">{appointment.notes}</p> : <p className="text-sm text-stone-500">No notes for this visit.</p>}
          </Card>

          {charts && client ? (
            <Card className="p-4">
              <div className="mb-2 flex items-center justify-between gap-3">
                <h2 className="font-medium">Charts</h2>
                {charts.write && charts.rows.length ? <Link href={`/app/${slug}/charts/new?clientId=${client.id}&appointmentId=${id}`} className="hit text-sm text-brand-700 hover:underline">Another chart</Link> : null}
              </div>
              {charts.rows.length ? (
                <ul className="divide-y divide-stone-100 text-sm">
                  {charts.rows.map((c) => (
                    <li key={c.id} className={`${rowClass} -mx-2 flex items-center gap-3 rounded-lg px-2 py-2`}>
                      <div className="min-w-0 flex-1">
                        <RowLink href={`/app/${slug}/charts/${c.id}`} className="font-medium">{c.templateSnapshot.name}{c.serviceName ? ` · ${c.serviceName}` : ""}</RowLink>
                        <p className="truncate text-xs text-stone-500">{c.signedAt ? `Signed by ${c.signedByName}` : `Started by ${c.authorName}`}</p>
                      </div>
                      <ChartStatusBadge signed={!!c.signedAt} />
                    </li>
                  ))}
                </ul>
              ) : charts.write ? (
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <p className="text-sm text-stone-500">Record what you did and saw, then sign it.</p>
                  <LinkButton href={`/app/${slug}/charts/new?clientId=${client.id}&appointmentId=${id}`} variant="secondary" size="sm">Chart this visit</LinkButton>
                </div>
              ) : <p className="text-sm text-stone-500">No chart for this visit.</p>}
            </Card>
          ) : null}

          {showLash && lash && client ? (
            <Card className="p-4">
              <div className="mb-2 flex items-center justify-between gap-3">
                <h2 className="font-medium">Lash map</h2>
                {lash.write ? <Link href={`/app/${slug}/clients/${client.id}/lash-maps/new?appointmentId=${id}`} className="text-sm text-brand-700 hover:underline">{lash.map ? "Update for this visit" : "Add lash map"}</Link> : null}
              </div>
              {lash.map ? (
                <Link href={`/app/${slug}/clients/${client.id}/lash-maps/${lash.map.id}`} className="block rounded-lg hover:bg-stone-50">
                  <p className="text-sm">{lash.map.title} <span className="text-stone-500">· {fmtDay.format(lash.map.updatedAt)}</span></p>
                  <LashMapEyes zones={lash.map.zones} rightZones={lash.map.rightZones} className="mx-auto max-w-2xl" />
                  {lash.map.notes ? <p className="whitespace-pre-line text-sm text-stone-700">{lash.map.notes}</p> : null}
                </Link>
              ) : <p className="text-sm text-stone-500">No lash map yet. Record lengths, curls and thickness by zone so the next fill matches.</p>}
            </Card>
          ) : null}

          {appointment.kind === "visit" && canNote && can(permissions, "inventory.log") ? <SuppliesCard slug={slug} businessId={business.id} appointmentId={id} /> : null}
          {appointment.kind === "visit" && canNote ? <VisitPhotosCard slug={slug} appointmentId={id} groups={photoGroups.filter((g) => coversLine(access, staffId ?? null, g.staffId))} pairs={photoPairs} tagSuggestions={photoTags} /> : null}
        </div>

        <div className="space-y-6">
          {group.length > 1 ? (
            <Card className="p-4">
              <h2 className="font-medium">Booked together</h2>
              <p className="mb-2 text-xs text-stone-500">One online booking, each person with their own appointment.</p>
              <ul className="-mx-4 divide-y divide-stone-100">
                {group.map((g) => (
                  <li key={g.id} className={g.id === id ? "bg-stone-50 px-4 py-2" : `${rowClass} px-4 py-2`}>
                    {g.id === id ? <span className="block text-sm font-medium">{g.name} <span className="font-normal text-stone-500">({g.lead ? "booked for everyone, " : ""}this one)</span></span> : <RowLink href={`/app/${slug}/appointments/${g.id}`} className="block text-sm font-medium">{g.name}{g.lead ? <span className="font-normal text-stone-500"> (booked for everyone)</span> : null}</RowLink>}
                    <span className="block text-xs text-stone-500">{g.services} · {g.staff} · {formatTime(g.start, tz)}{g.status === "cancelled" ? " · Cancelled" : g.status === "completed" ? " · Completed" : ""}</span>
                  </li>
                ))}
              </ul>
              {canCheckout && group.filter((g) => !g.sale && !["cancelled", "no_show", "completed"].includes(g.status)).length > 1 && !existingSale ? (
                <form action={startGroupCheckout} className="mt-3">
                  <input type="hidden" name="slug" value={slug} />
                  <input type="hidden" name="appointmentId" value={id} />
                  <Button type="submit" variant="secondary" className="w-full">Check out together · {formatMoney(group.filter((g) => !g.sale && !["cancelled", "no_show", "completed"].includes(g.status)).reduce((s, g) => s + g.total, 0), business.currency)}</Button>
                </form>
              ) : null}
            </Card>
          ) : null}

          {existingSale && can(permissions, "checkout.take") ? (
            <Card className="p-4">
              <h2 className="mb-2 font-medium">Checkout</h2>
              <LinkButton href={`/app/${slug}/sales/${existingSale.id}`} variant="primary" className="w-full">
                {existingSale.status === "open" ? `Continue checkout (#${existingSale.number})` : `View sale #${existingSale.number}`}
              </LinkButton>
            </Card>
          ) : !existingSale && canCheckout && appointment.status !== "cancelled" ? (
            <Card className="p-4">
              <h2 className="mb-2 font-medium">Checkout</h2>
              {forms.some((f) => !f.current) ? (
                <div className="space-y-2">
                  <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                    {forms.filter((f) => !f.current).length} required form{forms.filter((f) => !f.current).length === 1 ? "" : "s"} outstanding: {forms.filter((f) => !f.current).map((f) => f.form.name).join(", ")}.
                  </p>
                  {client && canFillForms ? (
                    <LinkButton href={`/app/${slug}/forms/fill/${forms.find((f) => !f.current)!.form.id}?clientId=${client.id}&appointmentId=${appointment.id}`} variant="primary" className="w-full">Complete forms now</LinkButton>
                  ) : null}
                  <form action={startCheckout}>
                    <input type="hidden" name="slug" value={slug} />
                    <input type="hidden" name="appointmentId" value={id} />
                    <input type="hidden" name="skipForms" value="1" />
                    <Button type="submit" variant="secondary" className="w-full">Check out anyway · {formatMoney(total, business.currency)}</Button>
                  </form>
                </div>
              ) : (
                <form action={startCheckout}>
                  <input type="hidden" name="slug" value={slug} />
                  <input type="hidden" name="appointmentId" value={id} />
                  <Button type="submit" className="w-full">Check out · {formatMoney(total, business.currency)}</Button>
                </form>
              )}
            </Card>
          ) : null}

          {showStatusButtons || showCancel || appointment.status === "cancelled" ? (
            <Card className="p-4">
              <h2 className={showStatusButtons ? "mb-3 font-medium" : "mb-1 font-medium"}>Status</h2>
              {showStatusButtons ? (
                <form action={changeStatus} className="flex flex-wrap gap-1.5">
                  <input type="hidden" name="slug" value={slug} />
                  <input type="hidden" name="appointmentId" value={id} />
                  {(["confirmed", "checked_in", "in_progress", "completed", "no_show"] as const)
                    .filter((s) => s !== appointment.status)
                    .map((s) => (
                      s === "no_show" ? (
                        <ConfirmSubmit key={s} name="status" value={s} title="Mark as no-show?" body={`This counts against the client's history.${showNoShowFee ? " To charge the saved card as well, use No-show fee below." : ""}`} confirmLabel="Mark no-show" variant="secondary">{STATUS_LABEL[s]}</ConfirmSubmit>
                      ) : (
                      <Button key={s} name="status" value={s} size="sm" variant="secondary" type="submit">
                        {STATUS_LABEL[s]}
                      </Button>)
                    ))}
                </form>
              ) : null}
              {appointment.status === "cancelled" ? (
                <p className="text-sm text-stone-500">
                  Cancelled{appointment.cancelledBy === "client" ? " by the client" : ""}{appointment.cancelledLate ? ", inside the cancellation window" : ""}
                  {cancelReasonName ? `: ${cancelReasonName}` : ""}{appointment.cancellationReason ? ` (${appointment.cancellationReason})` : ""}.
                </p>
              ) : showCancel ? (
                <details className={showStatusButtons ? "group mt-3 border-t border-stone-200 pt-3" : "group"}>
                  <summary className="cursor-pointer select-none text-sm text-stone-500 hover:text-stone-800 marker:content-none [&::-webkit-details-marker]:hidden">Cancel this appointment…</summary>
                  <CancelForm slug={slug} appointmentId={id} late={lateCancel} cards={savedCards} reasons={(await listCancellationReasons(business.id)).map((r) => ({ id: r.id, name: r.name }))} deposit={depositChoice} />
                </details>
              ) : null}
            </Card>
          ) : null}

          {forms.length ? (
            <Card className="p-4 text-sm">
              <h2 className="mb-1 font-medium">Forms · {forms.filter((f) => f.current).length}/{forms.length} complete</h2>
              <ul className="space-y-1">
                {forms.map((f) => (
                  <li key={f.form.id} className="flex items-center justify-between gap-2">
                    <span>{f.current ? "✓" : "○"} {f.form.name}</span>
                    <span className="flex items-center gap-2 text-xs">
                      {f.submission ? <Link href={`/app/${slug}/settings/forms/submissions/${f.submission.id}`} className="text-brand-700 underline">{f.current ? "View" : "Expired · view"}</Link> : null}
                      {!f.current && client && canFillForms ? <Link href={`/app/${slug}/forms/fill/${f.form.id}?clientId=${client.id}&appointmentId=${appointment.id}`} className="rounded border border-brand-300 bg-brand-50 px-1.5 py-0.5 text-brand-800">Complete here</Link> : !f.submission ? <span className="text-stone-400">not yet</span> : null}
                    </span>
                  </li>
                ))}
              </ul>
              {forms.some((f) => !f.current) ? <p className="mt-2 text-xs text-stone-500">Client link: <a className="underline" href={appUrl(`/book/${business.slug}/manage/${appointment.manageToken}/forms`)} target="_blank" rel="noreferrer">open forms page</a> (also in their confirmation and reminder).</p> : null}
            </Card>
          ) : null}

          {series ? (
            <Card className="p-4 text-sm">
              <h2 className="mb-1 font-medium">Standing appointment</h2>
              <p className="text-stone-600">Every {series.series.intervalWeeks === 1 ? "week" : `${series.series.intervalWeeks} weeks`} · {series.occurrences.filter((o) => o.status !== "cancelled").length} of {series.series.occurrences} visits{series.series.endedAt ? " · ended" : ""}</p>
              <ul className="mt-2 max-h-40 space-y-0.5 overflow-y-auto text-xs">
                {series.occurrences.map((o) => (
                  <li key={o.id} className={o.id === id ? "font-semibold" : o.status === "cancelled" ? "text-stone-400 line-through" : ""}>
                    <Link href={`/app/${slug}/appointments/${o.id}`} className="hover:underline">{new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: tz }).format(o.startAt)}</Link> · {STATUS_LABEL[o.status] ?? o.status}
                  </li>
                ))}
              </ul>
              {!locked && canCancel && series.occurrences.some((o) => o.startAt >= (first?.startAt ?? new Date()) && (o.status === "booked" || o.status === "confirmed")) ? (
                <form action={cancelSeries} className="mt-3 border-t border-stone-200 pt-3">
                  <input type="hidden" name="slug" value={slug} />
                  <input type="hidden" name="appointmentId" value={id} />
                  <ConfirmSubmit title="Cancel this and all later visits?" body="Earlier visits in the series are left alone. The client is notified once." confirmLabel="Cancel remaining visits" variant="secondary">Cancel this and later visits</ConfirmSubmit>
                </form>
              ) : null}
            </Card>
          ) : null}

          {review ? (
            <Card className="p-4 text-sm">
              <h2 className="mb-1 font-medium">Rating</h2>
              {review.submittedAt && review.rating ? (
                <>
                  <p><span className="text-lg text-amber-400">{"★".repeat(review.rating)}<span className="text-stone-200">{"★".repeat(5 - review.rating)}</span></span> <span className="text-xs text-stone-500">{fmtDay.format(review.submittedAt)}</span></p>
                  {review.comment ? <p className="mt-1 text-stone-700">“{review.comment}”</p> : <p className="mt-1 text-xs text-stone-500">No comment left.</p>}
                  <p className="mt-2 text-xs text-stone-500"><Link href={`/app/${slug}/reviews`} className="text-brand-700 underline">All reviews</Link></p>
                </>
              ) : (
                <p className="text-stone-500">Rating requested {fmtDay.format(review.requestedAt)} · no reply yet.</p>
              )}
            </Card>
          ) : null}

          {appointment.depositStatus !== "none" || appointment.cardSetupIntentId ? (
            <Card className="p-4 text-sm">
              <h2 className="mb-1 font-medium">Paid online</h2>
              {appointment.depositStatus !== "none" ? (
                <p>
                  Deposit {formatMoney(appointment.depositCents, business.currency)}
                  {appointment.depositCardLabel ? ` · ${appointment.depositCardLabel}` : ""} ·{" "}
                  {appointment.depositStatus === "paid" ? "held, comes off the bill at checkout" : appointment.depositStatus === "applied" ? "applied to the sale" : "refunded"}
                </p>
              ) : null}
              {appointment.cardSetupIntentId ? <p className="text-stone-600">Card saved on file at booking.</p> : null}
              {appointment.depositStatus === "paid" && !existingSale && can(permissions, "checkout.refund") ? (
                <form action={refundDepositAction} className="mt-2">
                  <input type="hidden" name="slug" value={slug} />
                  <input type="hidden" name="appointmentId" value={id} />
                  {business.depositRefundAs === "store_credit" ? (
                    <ConfirmSubmit title="Return the deposit as store credit?" body="Your policy returns deposits as store credit: the client gets the amount to spend on a future visit and the money stays with you." confirmLabel="Give store credit" variant="secondary">Return as store credit</ConfirmSubmit>
                  ) : (
                    <ConfirmSubmit title="Refund the deposit?" body="The deposit goes back to the client's card through Stripe. This can't be undone." confirmLabel="Refund deposit" variant="secondary">Refund deposit</ConfirmSubmit>
                  )}
                </form>
              ) : null}
            </Card>
          ) : null}

          {appointment.policyAcceptedAt && appointment.policyText ? (
            <Card className="p-4 text-sm">
              <h2 className="mb-1 font-medium">Cancellation policy agreed</h2>
              <p className="text-xs text-stone-500">When booking online, {new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: tz }).format(appointment.policyAcceptedAt)}{appointment.policyAcceptedIp ? ` · from ${appointment.policyAcceptedIp}` : ""}. Useful if a fee or deposit is disputed.</p>
              <p className="mt-1 text-stone-700">{appointment.policyText}</p>
            </Card>
          ) : null}

          {showNoShowFee ? (
            <Disclosure title="No-show fee" hint="charge the saved card">
              <p className="mb-2 text-xs text-stone-500">Charges the client&apos;s saved card and marks the appointment as a no-show.</p>
              <NoShowFeeForm slug={slug} appointmentId={id} defaultAmount={((business.noShowFeeCents || Math.min(total, 2500)) / 100).toFixed(2)} cards={savedCards} />
            </Disclosure>
          ) : null}

          <Card className="p-4">
            <h2 className="mb-2 font-medium">Client</h2>
            {client ? (
              <div className="space-y-1 text-sm">
                <p className="font-medium">{client.firstName} {client.lastName}</p>
                {canContact && client.phone ? <p className="text-stone-600">{client.phone}</p> : null}
                {canContact && client.email ? <p className="text-stone-600">{client.email}</p> : null}
                {canClientNotes && client.notes ? <p className="mt-2 rounded-md bg-amber-50 p-2 text-xs text-amber-900">{client.notes}</p> : null}
                {pinnedNotes.map((n) => <p key={n.id} className="mt-2 whitespace-pre-line rounded-md border border-amber-200 bg-amber-50 p-2 text-xs text-amber-900">{n.body}</p>)}
                {can(permissions, "clients.read") ? <Link href={`/app/${slug}/clients/${client.id}`} className="mt-2 inline-block text-xs text-brand-700 underline">Open client</Link> : null}
              </div>
            ) : (
              <p className="text-sm text-stone-500">No client attached.</p>
            )}
          </Card>

          <ActivityTrail summary={activity.summary} events={activity.events} timeZone={tz} mode="appointment" />
        </div>
      </div>
    </>
  );
}

/** The appointments booked together with this one, booker first, each with its ticket (its own, or a shared one) if it has one. */
async function groupMembers(businessId: string, groupId: string) {
  return withTenant(businessId, async (tx) => {
    const rows = await tx
      .select({ id: schema.appointments.id, status: schema.appointments.status, first: schema.clients.firstName, last: schema.clients.lastName, itemId: schema.appointmentItems.id, name: schema.appointmentItems.serviceName, staff: schema.staff.displayName, startAt: schema.appointmentItems.startAt, priceCents: schema.appointmentItems.priceCents, itemStatus: schema.appointmentItems.status })
      .from(schema.appointments)
      .innerJoin(schema.appointmentItems, eq(schema.appointmentItems.appointmentId, schema.appointments.id))
      .innerJoin(schema.staff, eq(schema.staff.id, schema.appointmentItems.staffId))
      .leftJoin(schema.clients, eq(schema.clients.id, schema.appointments.clientId))
      .where(eq(schema.appointments.groupId, groupId))
      .orderBy(asc(schema.appointmentItems.startAt));
    const ids = [...new Set(rows.map((r) => r.id))];
    const own = ids.length ? await tx.select({ id: schema.sales.id, number: schema.sales.number, status: schema.sales.status, appointmentId: schema.sales.appointmentId }).from(schema.sales).where(and(inArray(schema.sales.appointmentId, ids), ne(schema.sales.status, "void"))) : [];
    const carried = rows.length ? await tx.select({ itemId: schema.saleLines.appointmentItemId, id: schema.sales.id, number: schema.sales.number, status: schema.sales.status }).from(schema.saleLines).innerJoin(schema.sales, eq(schema.sales.id, schema.saleLines.saleId)).where(and(inArray(schema.saleLines.appointmentItemId, rows.map((r) => r.itemId)), ne(schema.sales.status, "void"))) : [];
    return ids
      .map((apptId) => {
        const mine = rows.filter((r) => r.id === apptId);
        const live = mine.filter((r) => r.itemStatus !== "cancelled");
        const shown = (live.length ? live : mine).filter((r) => !r.name.endsWith(" (finish)"));
        const sale = own.find((x) => x.appointmentId === apptId) ?? carried.find((x) => mine.some((r) => r.itemId === x.itemId)) ?? null;
        return { id: apptId, lead: apptId === groupId, status: mine[0]!.status, name: `${mine[0]!.first ?? "Walk-in"} ${mine[0]!.last ?? ""}`.trim(), services: shown.map((r) => r.name).join(", "), staff: [...new Set(shown.map((r) => r.staff))].join(" & "), start: mine[0]!.startAt, total: live.reduce((s, r) => s + r.priceCents, 0), sale: sale ? { id: sale.id, number: sale.number, status: sale.status } : null };
      })
      .sort((a, b) => (a.lead ? -1 : b.lead ? 1 : a.start.getTime() - b.start.getTime()));
  });
}
