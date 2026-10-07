import Link from "next/link";
import type { Metadata } from "next";
import { Plus } from "lucide-react";
import { StatusBadge } from "@/components/status-badge";
import { ActionForm, Field, SubmitButton } from "@/components/form";
import { notFound } from "next/navigation";
import { and, asc, desc, eq, gt, isNull, or } from "drizzle-orm";
import { schema, withTenant } from "@angelic/db";
import { can } from "@angelic/core";
import { requireBusiness } from "@/lib/tenant";
import { formatMoney, formatTime } from "@/lib/utils";
import { BackLink, Card, Input, LinkButton, PageHeader, Textarea, Empty } from "@/components/ui";
import { updateClient } from "../actions";
import { addNote, deleteNote, togglePin } from "./notes-actions";
import { Pin, PinOff } from "lucide-react";
import { db } from "@angelic/db";
import { inArray } from "drizzle-orm";
import { Textarea as NoteArea } from "@/components/ui";
import { ConfirmSubmit, SubmitButton as NoteSubmit } from "@/components/form";
import { relative } from "@/lib/format";

export async function generateMetadata({ params }: { params: Promise<{ slug: string; clientId: string }> }): Promise<Metadata> {
  const { slug, clientId } = await params;
  const { business } = await requireBusiness(slug);
  const c = await withTenant(business.id, (tx) => tx.query.clients.findFirst({ where: eq(schema.clients.id, clientId) }));
  return { title: c ? `${c.firstName} ${c.lastName}`.trim() + " · Clients" : "Client" };
}

export default async function ClientPage({ params }: { params: Promise<{ slug: string; clientId: string }> }) {
  const { slug, clientId } = await params;
  const { business, permissions } = await requireBusiness(slug);
  const data = await withTenant(business.id, async (tx) => {
    const client = await tx.query.clients.findFirst({ where: eq(schema.clients.id, clientId) });
    if (!client) return null;
    const now = new Date();
    const notes = await tx.select().from(schema.clientNotes).where(eq(schema.clientNotes.clientId, clientId)).orderBy(desc(schema.clientNotes.pinned), desc(schema.clientNotes.createdAt)).limit(100);
    const [visits, sales, packs, memberships] = await Promise.all([
      tx
        .select({ id: schema.appointments.id, status: schema.appointments.status, startAt: schema.appointmentItems.startAt, serviceName: schema.appointmentItems.serviceName, staffName: schema.staff.displayName })
        .from(schema.appointmentItems)
        .innerJoin(schema.appointments, eq(schema.appointments.id, schema.appointmentItems.appointmentId))
        .innerJoin(schema.staff, eq(schema.staff.id, schema.appointmentItems.staffId))
        .where(and(eq(schema.appointments.clientId, clientId), eq(schema.appointmentItems.sortOrder, 0)))
        .orderBy(desc(schema.appointmentItems.startAt))
        .limit(50),
      tx.select().from(schema.sales).where(eq(schema.sales.clientId, clientId)).orderBy(desc(schema.sales.createdAt)).limit(20),
      tx
        .select({ id: schema.clientPackages.id, name: schema.packages.name, remaining: schema.clientPackages.remaining, expiresAt: schema.clientPackages.expiresAt })
        .from(schema.clientPackages)
        .innerJoin(schema.packages, eq(schema.packages.id, schema.clientPackages.packageId))
        .where(and(eq(schema.clientPackages.clientId, clientId), or(isNull(schema.clientPackages.expiresAt), gt(schema.clientPackages.expiresAt, now))))
        .orderBy(asc(schema.packages.name)),
      tx
        .select({ id: schema.clientMemberships.id, name: schema.membershipPlans.name, status: schema.clientMemberships.status, creditsRemaining: schema.clientMemberships.creditsRemaining, currentPeriodEnd: schema.clientMemberships.currentPeriodEnd })
        .from(schema.clientMemberships)
        .innerJoin(schema.membershipPlans, eq(schema.membershipPlans.id, schema.clientMemberships.planId))
        .where(eq(schema.clientMemberships.clientId, clientId)),
    ]);
    return { client, visits, sales, packs, memberships, notes };
  });
  if (!data) notFound();
  const { client, visits, sales, packs, memberships, notes } = data;
  const authorIds = [...new Set(notes.map((n) => n.authorUserId).filter((x): x is string => !!x))];
  const authors = authorIds.length ? await db.select({ id: schema.user.id, name: schema.user.name }).from(schema.user).where(inArray(schema.user.id, authorIds)) : [];
  const authorName = (id: string | null) => authors.find((a) => a.id === id)?.name ?? "Staff";
  const tz = business.timezone;
  const fmtDate = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeZone: tz });
  const done = new Set(["cancelled", "completed", "no_show"]);
  const upcoming = visits.filter((v) => v.startAt >= new Date() && !done.has(v.status));
  const past = visits.filter((v) => v.startAt < new Date() || done.has(v.status));
  const money = (c: number) => formatMoney(c, business.currency);
  const write = can(permissions, "clients.write");

  return (
    <>
      <div className="mb-2"><BackLink href={`/app/${slug}/clients`}>Clients</BackLink></div>
      <PageHeader title={`${client.firstName} ${client.lastName}`.trim()}>
        {can(permissions, "appointments.write.any") ? <LinkButton href={`/app/${slug}/appointments/new?clientId=${client.id}`} variant="primary"><Plus className="h-4 w-4" /> Book appointment</LinkButton> : null}
      </PageHeader>
      <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
        <div className="space-y-6">
          <Card>
            <h2 className="border-b border-stone-200 px-4 py-2 text-sm font-semibold text-stone-600">Notes &amp; formulas</h2>
            {notes.length === 0 ? <p className="px-4 py-3 text-sm text-stone-500">No notes yet. Formulas, allergies, how they take their coffee.</p> : (
              <ul className="divide-y divide-stone-100">
                {notes.map((n) => (
                  <li key={n.id} className={`flex items-start gap-3 px-4 py-3 text-sm ${n.pinned ? "bg-amber-50/60" : ""}`}>
                    <div className="min-w-0 flex-1">
                      <p className="whitespace-pre-line">{n.body}</p>
                      <p className="mt-1 text-xs text-stone-500">{authorName(n.authorUserId)} · {relative(n.createdAt)}{n.pinned ? " · pinned" : ""}</p>
                    </div>
                    {write ? (
                      <div className="flex shrink-0 items-center gap-1">
                        <form action={togglePin}>
                          <input type="hidden" name="slug" value={slug} /><input type="hidden" name="clientId" value={client.id} /><input type="hidden" name="noteId" value={n.id} /><input type="hidden" name="pinned" value={n.pinned ? "false" : "true"} />
                          <button className="rounded p-1 text-stone-400 hover:bg-stone-100 hover:text-stone-700" title={n.pinned ? "Unpin" : "Pin to top"} aria-label={n.pinned ? "Unpin note" : "Pin note to top"}>{n.pinned ? <PinOff className="h-4 w-4" /> : <Pin className="h-4 w-4" />}</button>
                        </form>
                        <form action={deleteNote}>
                          <input type="hidden" name="slug" value={slug} /><input type="hidden" name="clientId" value={client.id} /><input type="hidden" name="noteId" value={n.id} />
                          <ConfirmSubmit title="Delete this note?" confirmLabel="Delete" variant="ghost" className="text-stone-400 hover:text-red-600">Delete</ConfirmSubmit>
                        </form>
                      </div>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
            {write ? (
              <div className="border-t border-stone-200 p-4">
                <ActionForm action={addNote} className="space-y-2">
                  <input type="hidden" name="slug" value={slug} />
                  <input type="hidden" name="clientId" value={client.id} />
                  <Field label="Add a note" name="body"><NoteArea name="body" rows={2} placeholder="e.g. 7N + 8.1 equal parts, 20 vol, 35 min" required /></Field>
                  <div className="flex items-center justify-between">
                    <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="pinned" className="h-4 w-4 accent-brand-600" /> Pin to top</label>
                    <NoteSubmit size="sm" variant="secondary" pendingText="Saving…">Add note</NoteSubmit>
                  </div>
                </ActionForm>
              </div>
            ) : null}
          </Card>
          <Card>
            <h2 className="border-b border-stone-200 px-4 py-2 text-sm font-semibold text-stone-600">Upcoming</h2>
            {upcoming.length === 0 ? <div className="p-4"><Empty title="Nothing booked" /></div> : (
              <ul className="divide-y divide-stone-100 text-sm">
                {upcoming.reverse().map((v) => (
                  <li key={v.id}><Link href={`/app/${slug}/appointments/${v.id}`} className="flex items-center justify-between px-4 py-2 hover:bg-stone-50"><span>{fmtDate.format(v.startAt)} · {formatTime(v.startAt, tz)} · {v.serviceName} with {v.staffName}</span><StatusBadge status={v.status} /></Link></li>
                ))}
              </ul>
            )}
          </Card>
          <Card>
            <h2 className="border-b border-stone-200 px-4 py-2 text-sm font-semibold text-stone-600">History</h2>
            {past.length === 0 ? <div className="p-4"><Empty title="No past visits" /></div> : (
              <ul className="divide-y divide-stone-100 text-sm">
                {past.map((v) => (
                  <li key={v.id}><Link href={`/app/${slug}/appointments/${v.id}`} className="flex items-center justify-between px-4 py-2 hover:bg-stone-50"><span className={v.status === "cancelled" || v.status === "no_show" ? "text-stone-400" : ""}>{fmtDate.format(v.startAt)} · {v.serviceName} with {v.staffName}</span><StatusBadge status={v.status} /></Link></li>
                ))}
              </ul>
            )}
          </Card>
          <Card>
            <h2 className="border-b border-stone-200 px-4 py-2 text-sm font-semibold text-stone-600">Sales</h2>
            {sales.length === 0 ? <div className="p-4"><Empty title="No sales yet" /></div> : (
              <ul className="divide-y divide-stone-100 text-sm">
                {sales.map((s) => (
                  <li key={s.id}><Link href={`/app/${slug}/sales/${s.id}`} className="flex items-center justify-between px-4 py-2 hover:bg-stone-50"><span>#{s.number} · {fmtDate.format(s.createdAt)}</span><span className="flex items-center gap-2">{money(s.totalCents)} <StatusBadge status={s.status} /></span></Link></li>
                ))}
              </ul>
            )}
          </Card>
        </div>
        <div className="space-y-6">
          <Card className="p-4">
            <h2 className="mb-3 font-medium">Details</h2>
            {write ? (
              <ActionForm action={updateClient}>
                <input type="hidden" name="slug" value={slug} />
                <input type="hidden" name="clientId" value={client.id} />
                <div className="grid grid-cols-2 gap-3">
                  <Field label="First name" name="firstName" required><Input name="firstName" defaultValue={client.firstName} required /></Field>
                  <Field label="Last name" name="lastName"><Input name="lastName" defaultValue={client.lastName} /></Field>
                </div>
                <Field label="Mobile phone" name="phone"><Input name="phone" type="tel" defaultValue={client.phone ?? ""} /></Field>
                <Field label="Email" name="email"><Input name="email" type="email" defaultValue={client.email ?? ""} /></Field>
                <Field label="Notes" name="notes"><Textarea name="notes" rows={4} defaultValue={client.notes ?? ""} /></Field>
                <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="smsOptIn" defaultChecked={client.smsOptIn} className="h-4 w-4 accent-brand-600" /> Text messages</label>
                <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="emailOptIn" defaultChecked={client.emailOptIn} className="h-4 w-4 accent-brand-600" /> Emails</label>
                <SubmitButton variant="secondary" pendingText="Saving…">Save</SubmitButton>
              </ActionForm>
            ) : (
              <div className="space-y-1 text-sm">
                {client.phone ? <p>{client.phone}</p> : null}
                {client.email ? <p>{client.email}</p> : null}
                {client.notes ? <p className="mt-2 rounded-md bg-amber-50 p-2 text-xs text-amber-900">{client.notes}</p> : null}
              </div>
            )}
          </Card>
          <Card className="p-4 text-sm">
            <h2 className="mb-2 font-medium">Packages &amp; memberships</h2>
            {packs.length === 0 && memberships.length === 0 ? <p className="text-stone-500">None.</p> : null}
            {packs.map((p) => <p key={p.id}>{p.name} · {p.remaining} session{p.remaining === 1 ? "" : "s"} left{p.expiresAt ? ` · expires ${fmtDate.format(p.expiresAt)}` : ""}</p>)}
            {memberships.map((m) => <p key={m.id}>{m.name} · {m.status}{m.status === "active" ? ` · ${m.creditsRemaining} credit${m.creditsRemaining === 1 ? "" : "s"} · renews ${fmtDate.format(m.currentPeriodEnd)}` : ""}</p>)}
          </Card>
          <p className="text-xs text-stone-400">Client since {fmtDate.format(client.createdAt)}{client.tags.length ? ` · ${client.tags.join(", ")}` : ""}</p>
        </div>
      </div>
    </>
  );
}
