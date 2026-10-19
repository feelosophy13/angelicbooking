import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { can, instantToISODate } from "@angelic/core";
import { requireAnyAction } from "@/lib/tenant";
import { canManageClass, canSeeClassSession, canSeeClientContact, canSeePrices } from "@/lib/visibility";
import { getSession } from "@/server/classes";
import { StatusBadge } from "@/components/status-badge";
import { ActionForm, ConfirmSubmit, Field, SubmitButton } from "@/components/form";
import { BackLink, Button, Card, Input, PageHeader, Textarea, Empty } from "@/components/ui";
import { ClientPicker } from "@/components/client-picker";
import { quickCreateClient } from "../../clients/actions";
import { formatDateLong, formatMoney, formatTime } from "@/lib/utils";
import { addToClass, cancelClass } from "../actions";
import { changeStatus } from "../../appointments/[id]/actions";

export async function generateMetadata({ params }: { params: Promise<{ slug: string; sessionId: string }> }): Promise<Metadata> {
  const { slug, sessionId } = await params;
  const { business, permissions, staffId } = await requireAnyAction(slug, "appointments.read.any", "appointments.read.own");
  const s = await getSession(business.id, sessionId);
  return { title: s?.service && canSeeClassSession(permissions, staffId ?? null, s.session.staffId) ? `${s.service.name} · Classes` : "Class" };
}

export default async function ClassSessionPage({ params }: { params: Promise<{ slug: string; sessionId: string }> }) {
  const { slug, sessionId } = await params;
  const { business, permissions, staffId } = await requireAnyAction(slug, "appointments.read.any", "appointments.read.own");
  const s = await getSession(business.id, sessionId);
  // An own-calendar role opens only their own classes; another instructor's class is as good as absent.
  if (!s || !canSeeClassSession(permissions, staffId ?? null, s.session.staffId)) notFound();
  const tz = business.timezone;
  // Filling or cancelling this class: every class, or the ones this person teaches (A2).
  const write = canManageClass(permissions, staffId ?? null, s.session.staffId);
  // The roster prints contact details only to whoever may view clients.
  const contact = canSeeClientContact(permissions);
  const open = s.session.status === "scheduled" && s.session.startAt > new Date();
  const date = instantToISODate(s.session.startAt, tz);
  return (
    <>
      <div className="mb-2"><BackLink href={`/app/${slug}/classes`}>Classes</BackLink></div>
      <PageHeader title={s.service?.name ?? "Class"}>
        {s.session.status === "cancelled" ? <StatusBadge status="cancelled" /> : null}
      </PageHeader>
      <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
        <div className="space-y-6">
          <Card>
            <div className="flex items-center justify-between border-b border-stone-200 px-4 py-2">
              <h2 className="text-sm font-semibold text-stone-600">Roster · {s.booked}/{s.session.capacity}</h2>
              {s.seatsLeft === 0 && open ? <span className="text-xs font-medium text-amber-700">Full</span> : null}
            </div>
            {s.roster.length === 0 ? <div className="p-4"><Empty title="Nobody booked yet" body={write && open ? "Clients can book seats online, or add them on the right." : "Clients can book seats online."} /></div> : (
              <ul className="divide-y divide-stone-100 text-sm">
                {s.roster.map((r) => (
                  <li key={r.appointmentId} className="flex flex-wrap items-center gap-3 px-4 py-2">
                    <div className="min-w-0 flex-1">
                      <Link href={`/app/${slug}/appointments/${r.appointmentId}`} className={`font-medium hover:underline ${r.status === "cancelled" || r.status === "no_show" ? "text-stone-400 line-through" : ""}`}>{r.firstName ? `${r.firstName} ${r.lastName ?? ""}`.trim() : "Walk-in"}</Link>
                      <p className="text-xs text-stone-500">{[contact ? r.phone : null, contact ? r.email : null, r.source === "online" ? "booked online" : null, r.depositStatus === "paid" || r.depositStatus === "applied" ? "deposit paid" : null].filter(Boolean).join(" · ")}</p>
                    </div>
                    <StatusBadge status={r.status} />
                    {write && open && (r.status === "booked" || r.status === "confirmed") ? (
                      <form action={changeStatus} className="flex gap-1">
                        <input type="hidden" name="slug" value={slug} />
                        <input type="hidden" name="appointmentId" value={r.appointmentId} />
                        <Button name="status" value="checked_in" size="sm" variant="ghost" type="submit">Check in</Button>
                        <ConfirmSubmit name="status" value="cancelled" title="Remove this client from the class?" body="Their seat opens up and they are notified." confirmLabel="Remove" variant="ghost" className="text-xs">Remove</ConfirmSubmit>
                      </form>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
        <div className="space-y-6">
          <Card className="p-4 text-sm">
            <p className="font-medium">{formatDateLong(date)}</p>
            <p>{formatTime(s.session.startAt, tz)} – {formatTime(s.session.endAt, tz)} with {s.staff?.displayName ?? "—"}</p>
            <p className="text-stone-600">{canSeePrices(permissions) ? `${formatMoney(s.session.priceCents, business.currency)} per seat · ` : ""}{s.session.capacity} seats</p>
            {s.session.notes ? <p className="mt-2 rounded-md bg-stone-50 p-2 text-xs text-stone-700">{s.session.notes}</p> : null}
          </Card>
          {write && open ? (
            <Card className="p-4">
              <h2 className="mb-3 font-medium">Add a client</h2>
              {s.seatsLeft === 0 ? <p className="text-sm text-stone-500">This class is full.</p> : (
                <ActionForm action={addToClass}>
                  <input type="hidden" name="slug" value={slug} />
                  <input type="hidden" name="sessionId" value={sessionId} />
                  <Field label="Client" name="clientId">
                    <ClientPicker slug={slug} initial={null} canCreate={can(permissions, "clients.write")} createClient={quickCreateClient} />
                  </Field>
                  <Field label="Notes" name="notes"><Textarea name="notes" rows={4} /></Field>
                  <SubmitButton variant="secondary" pendingText="Adding…">Add to class</SubmitButton>
                </ActionForm>
              )}
            </Card>
          ) : null}
          {write && open ? (
            <Card className="p-4">
              <details className="group">
                <summary className="cursor-pointer select-none text-sm text-stone-500 hover:text-stone-800 marker:content-none [&::-webkit-details-marker]:hidden">Cancel this class…</summary>
                <form action={cancelClass} className="mt-3 space-y-3">
                  <input type="hidden" name="slug" value={slug} />
                  <input type="hidden" name="sessionId" value={sessionId} />
                  <Field label="Reason (optional)" name="reason"><Input name="reason" /></Field>
                  <ConfirmSubmit title="Cancel this class?" body={`${s.booked} booked client${s.booked === 1 ? "" : "s"} will be cancelled and notified.`} confirmLabel="Cancel class" variant="danger" className="w-full">Cancel class</ConfirmSubmit>
                </form>
              </details>
            </Card>
          ) : null}
        </div>
      </div>
    </>
  );
}
