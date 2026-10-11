import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { asc } from "drizzle-orm";
import { schema, withTenant } from "@angelic/db";
import { can, instantToISODate } from "@angelic/core";
import { requireBusiness } from "@/lib/tenant";
import { getSession } from "@/server/classes";
import { StatusBadge } from "@/components/status-badge";
import { ActionForm, ConfirmSubmit, Field, SubmitButton } from "@/components/form";
import { BackLink, Card, Input, PageHeader, Select, Textarea, Empty } from "@/components/ui";
import { formatDateLong, formatMoney, formatTime } from "@/lib/utils";
import { addToClass, cancelClass } from "../actions";
import { changeStatus } from "../../appointments/[id]/actions";

export async function generateMetadata({ params }: { params: Promise<{ slug: string; sessionId: string }> }): Promise<Metadata> {
  const { slug, sessionId } = await params;
  const { business } = await requireBusiness(slug);
  const s = await getSession(business.id, sessionId);
  return { title: s?.service ? `${s.service.name} · Classes` : "Class" };
}

export default async function ClassSessionPage({ params }: { params: Promise<{ slug: string; sessionId: string }> }) {
  const { slug, sessionId } = await params;
  const { business, permissions } = await requireBusiness(slug);
  const s = await getSession(business.id, sessionId);
  if (!s) notFound();
  const tz = business.timezone;
  const write = can(permissions, "appointments.write.any");
  const open = s.session.status === "scheduled" && s.session.startAt > new Date();
  const clients = write ? await withTenant(business.id, (tx) => tx.select({ id: schema.clients.id, firstName: schema.clients.firstName, lastName: schema.clients.lastName, phone: schema.clients.phone }).from(schema.clients).orderBy(asc(schema.clients.lastName), asc(schema.clients.firstName)).limit(500)) : [];
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
            {s.roster.length === 0 ? <div className="p-4"><Empty title="Nobody booked yet" body="Clients can book seats online, or add them on the right." /></div> : (
              <ul className="divide-y divide-stone-100 text-sm">
                {s.roster.map((r) => (
                  <li key={r.appointmentId} className="flex flex-wrap items-center gap-3 px-4 py-2">
                    <div className="min-w-0 flex-1">
                      <Link href={`/app/${slug}/appointments/${r.appointmentId}`} className={`font-medium hover:underline ${r.status === "cancelled" || r.status === "no_show" ? "text-stone-400 line-through" : ""}`}>{r.firstName ? `${r.firstName} ${r.lastName ?? ""}`.trim() : "Walk-in"}</Link>
                      <p className="text-xs text-stone-500">{[r.phone, r.email, r.source === "online" ? "booked online" : null, r.depositStatus === "paid" || r.depositStatus === "applied" ? "deposit paid" : null].filter(Boolean).join(" · ")}</p>
                    </div>
                    <StatusBadge status={r.status} />
                    {write && open && (r.status === "booked" || r.status === "confirmed") ? (
                      <form action={changeStatus} className="flex gap-1">
                        <input type="hidden" name="slug" value={slug} />
                        <input type="hidden" name="appointmentId" value={r.appointmentId} />
                        <button name="status" value="checked_in" className="rounded border border-stone-300 bg-white px-2 py-1 text-xs hover:bg-stone-50">Check in</button>
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
            <p className="text-stone-600">{formatMoney(s.session.priceCents, business.currency)} per seat · {s.session.capacity} seats</p>
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
                    <Select name="clientId" defaultValue="">
                      <option value="">Walk-in / no client</option>
                      {clients.map((c) => <option key={c.id} value={c.id}>{c.firstName} {c.lastName}{c.phone ? ` · ${c.phone}` : ""}</option>)}
                    </Select>
                  </Field>
                  <Field label="Notes" name="notes"><Textarea name="notes" rows={4} /></Field>
                  <SubmitButton variant="secondary" pendingText="Adding…">Add to class</SubmitButton>
                </ActionForm>
              )}
            </Card>
          ) : null}
          {write && open ? (
            <Card className="p-4">
              <h2 className="mb-2 font-medium">Cancel class</h2>
              <form action={cancelClass} className="space-y-2">
                <input type="hidden" name="slug" value={slug} />
                <input type="hidden" name="sessionId" value={sessionId} />
                <Input name="reason" placeholder="Reason (optional)" />
                <ConfirmSubmit title="Cancel this class?" body={`${s.booked} booked client${s.booked === 1 ? "" : "s"} will be cancelled and notified.`} confirmLabel="Cancel class" variant="danger" className="w-full">Cancel class</ConfirmSubmit>
              </form>
            </Card>
          ) : null}
        </div>
      </div>
    </>
  );
}
