import Link from "next/link";
import type { Metadata } from "next";
import { Plus } from "lucide-react";
import { StatusBadge } from "@/components/status-badge";
import { rowClass, RowLink } from "@/components/row";
import { HistoryTimeline } from "./history-timeline";
import { ActionForm, Field, SubmitButton } from "@/components/form";
import { notFound } from "next/navigation";
import { and, asc, desc, eq, gt, isNull, or } from "drizzle-orm";
import { schema, withTenant } from "@angelic/db";
import { isSmsSuppressed } from "@/server/consent";
import { can } from "@angelic/core";
import { requireAction, requireBusiness } from "@/lib/tenant";
import { formatMoney, formatTime } from "@/lib/utils";
import { BackLink, Button, Card, Input, LinkButton, PageHeader, Textarea, Empty, Checkbox, MoneyInput } from "@/components/ui";
import { ImageField } from "@/components/image-field";
import { Disclosure } from "@/components/disclosure";
import { updateClient } from "../actions";
import { addNote, deleteNote, togglePin } from "./notes-actions";
import { Pin, PinOff } from "lucide-react";
import { db } from "@angelic/db";
import { inArray } from "drizzle-orm";
import { Textarea as NoteArea } from "@/components/ui";
import { ConfirmSubmit, SubmitButton as NoteSubmit } from "@/components/form";
import { relative } from "@/lib/format";
import { listGallery } from "@/server/visit-photos";
import { pairViews } from "@/lib/gallery-view";
import { PairCard } from "@/components/photo-pair";
import { listForms, listSubmissionsForClient } from "@/server/forms";
import { getClientLoyalty, referralsOf } from "@/server/loyalty";
import { clientStats } from "@/server/clients";
import { reviewsForClient } from "@/server/reviews";
import { adjustClientPoints, adjustClientStoreCredit, createReferralCode, sendReferralCodeAction } from "./loyalty-actions";
import { getClientStoreCredit } from "@/server/store-credit";
import { freezeMembershipAction, resumeMembershipAction, turnOffAutoRenew, turnOnAutoRenew } from "./membership-actions";
import { settleMemberships } from "@/server/offers";
import { isMembershipInterval, periodNoun } from "@angelic/core";
import { replyToClient } from "./messages-actions";
import { clientThread } from "@/server/inbound";
import { savedCardsFor } from "@/server/stripe-connect";
import { listLocations, paymentContextFor } from "@/server/locations";

export async function generateMetadata({ params }: { params: Promise<{ slug: string; clientId: string }> }): Promise<Metadata> {
  const { slug, clientId } = await params;
  const { business } = await requireBusiness(slug);
  const c = await withTenant(business.id, (tx) => tx.query.clients.findFirst({ where: eq(schema.clients.id, clientId) }));
  return { title: c ? `${c.firstName} ${c.lastName}`.trim() + " · Clients" : "Client" };
}

export default async function ClientPage({ params }: { params: Promise<{ slug: string; clientId: string }> }) {
  const { slug, clientId } = await params;
  const { business, permissions } = await requireAction(slug, "clients.read");
  const data = await withTenant(business.id, async (tx) => {
    const client = await tx.query.clients.findFirst({ where: eq(schema.clients.id, clientId) });
    if (!client) return null;
    const now = new Date();
    await settleMemberships(tx, clientId);
    const notes = await tx.select().from(schema.clientNotes).where(eq(schema.clientNotes.clientId, clientId)).orderBy(desc(schema.clientNotes.pinned), desc(schema.clientNotes.createdAt)).limit(100);
    const [visits, sales, packs, memberships] = await Promise.all([
      tx
        .select({ id: schema.appointments.id, status: schema.appointments.status, startAt: schema.appointmentItems.startAt, serviceName: schema.appointmentItems.serviceName, staffName: schema.staff.displayName, locationName: schema.locations.name })
        .from(schema.appointmentItems)
        .innerJoin(schema.appointments, eq(schema.appointments.id, schema.appointmentItems.appointmentId))
        .innerJoin(schema.staff, eq(schema.staff.id, schema.appointmentItems.staffId))
        .leftJoin(schema.locations, eq(schema.locations.id, schema.appointments.locationId))
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
        .select({ id: schema.clientMemberships.id, name: schema.membershipPlans.name, status: schema.clientMemberships.status, creditsRemaining: schema.clientMemberships.creditsRemaining, currentPeriodEnd: schema.clientMemberships.currentPeriodEnd, autoRenew: schema.clientMemberships.autoRenew, paymentFailedAt: schema.clientMemberships.paymentFailedAt, interval: schema.membershipPlans.interval, intervalCount: schema.membershipPlans.intervalCount, cycleCount: schema.membershipPlans.cycleCount, cyclesBilled: schema.clientMemberships.cyclesBilled, frozenUntil: schema.clientMemberships.frozenUntil })
        .from(schema.clientMemberships)
        .innerJoin(schema.membershipPlans, eq(schema.membershipPlans.id, schema.clientMemberships.planId))
        .where(eq(schema.clientMemberships.clientId, clientId)),
    ]);
    return { client, visits, sales, packs, memberships, notes };
  });
  if (!data) notFound();
  const { client, visits, sales, packs, memberships, notes } = data;
  const stopped = await withTenant(business.id, (tx) => isSmsSuppressed(tx, client.phone));
  const activeForms = (await listForms(business.id)).filter((f) => f.active);
  const [submissions, loyalty, reviews, thread, storeCredit, referrals, referredBy] = await Promise.all([
    listSubmissionsForClient(business.id, clientId),
    business.loyaltyEnabled ? getClientLoyalty(business.id, clientId) : Promise.resolve(null),
    reviewsForClient(business.id, clientId),
    clientThread(business.id, clientId),
    getClientStoreCredit(business.id, clientId),
    withTenant(business.id, (tx) => referralsOf(tx, clientId)),
    client.referredByClientId ? withTenant(business.id, async (tx) => { const r = await tx.query.clients.findFirst({ where: eq(schema.clients.id, client.referredByClientId!), columns: { id: true, firstName: true, lastName: true } }); return r ? { id: r.id, name: `${r.firstName} ${r.lastName ?? ""}`.trim() } : null; }) : Promise.resolve(null),
  ]);
  // Cards are shown for the client's home location's Stripe account (else the default site's).
  const pay = await paymentContextFor(business, client.homeLocationId);
  const multiLocation = (await listLocations(business.id)).length > 1;
  const at = (v: { locationName: string | null }) => (multiLocation && v.locationName ? ` · ${v.locationName.replace(/^.*? - /, "")}` : "");
  const stripeReady = pay.ready;
  const savedCards = await savedCardsFor(business.id, pay, client.id);
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
  // One timeline: past visits carry their ticket and rating; sales with no visit (retail, gift cards, open tickets) are rows too.
  const reviewFor = new Map(reviews.filter((r) => r.appointmentId).map((r) => [r.appointmentId!, r]));
  const saleFor = new Map(sales.filter((s) => s.appointmentId).map((s) => [s.appointmentId!, s]));
  const reviewAverage = reviews.length ? reviews.reduce((a, r) => a + (r.rating ?? 0), 0) / reviews.length : 0;
  type TimelineRow = { key: string; at: Date; kind: "visit" | "sale"; href: string; title: string; meta: string; status: string; sale: { id: string; number: number; totalCents: number; status: string } | null; review: { rating: number | null; comment: string | null } | null };
  const timeline: TimelineRow[] = [
    ...past.map((v): TimelineRow => {
      const s = saleFor.get(v.id);
      const r = reviewFor.get(v.id);
      return { key: `v:${v.id}`, at: v.startAt, kind: "visit", href: `/app/${slug}/appointments/${v.id}`, title: `${v.serviceName} with ${v.staffName}`, meta: at(v).replace(/^ · /, "· "), status: v.status, sale: s ? { id: s.id, number: s.number, totalCents: s.totalCents, status: s.status } : null, review: r ? { rating: r.rating, comment: r.comment } : null };
    }),
    ...sales.filter((s) => !s.appointmentId).map((s): TimelineRow => ({ key: `s:${s.id}`, at: s.closedAt ?? s.createdAt, kind: "sale", href: `/app/${slug}/sales/${s.id}`, title: `Ticket #${s.number}`, meta: s.status === "open" ? "· not an appointment · still open" : "· retail, gift card or package", status: s.status, sale: { id: s.id, number: s.number, totalCents: s.totalCents, status: s.status }, review: null })),
  ].sort((a, b) => b.at.getTime() - a.at.getTime());
  const stats = await withTenant(business.id, (tx) => clientStats(tx, client));
  const fmtMonth = new Intl.DateTimeFormat("en-US", { month: "short", year: "numeric", timeZone: tz });
  const sinceMonths = Math.max(0, Math.round((Date.now() - stats.since.getTime()) / (30.44 * 86_400_000)));
  const sinceLabel = sinceMonths < 1 ? "this month" : sinceMonths < 24 ? `${sinceMonths} mo` : `${Math.round(sinceMonths / 12)} yr`;
  const lapsed = stats.lastVisit && !stats.nextVisit ? Math.round((Date.now() - stats.lastVisit.getTime()) / 86_400_000) : null;
  const glance: { label: string; value: string; hint?: string; tone?: "warn" }[] = [
    { label: "Client since", value: fmtMonth.format(stats.since), hint: stats.sinceIsFirstVisit ? `${sinceLabel} · first visit` : `${sinceLabel} · no visit yet` },
    { label: "Visits", value: String(stats.completed), hint: [stats.upcoming ? `${stats.upcoming} upcoming` : null, stats.noShows ? `${stats.noShows} no-show${stats.noShows === 1 ? "" : "s"}` : null, stats.cancelled ? `${stats.cancelled} cancelled` : null].filter(Boolean).join(" · ") || "none upcoming", tone: stats.noShows >= 2 ? "warn" : undefined },
    { label: "Spent (before tips)", value: money(stats.spentCents), hint: stats.ticketCount ? `${money(stats.averageTicketCents)} per visit · plus ${money(stats.tipsCents)} tips` : "no paid visits yet" },
    { label: stats.nextVisit ? "Next visit" : "Last visit", value: stats.nextVisit ? fmtDate.format(stats.nextVisit) : stats.lastVisit ? fmtDate.format(stats.lastVisit) : "—", hint: stats.nextVisit && stats.lastVisit ? `last ${fmtDate.format(stats.lastVisit)}` : lapsed != null ? `${lapsed} days ago${stats.visitEveryDays && lapsed > stats.visitEveryDays * 1.5 ? " · overdue" : ""}` : undefined, tone: lapsed != null && stats.visitEveryDays && lapsed > stats.visitEveryDays * 1.5 ? "warn" : undefined },
    { label: "Usually", value: stats.favouriteService ?? "—", hint: [stats.usualProvider ? `with ${stats.usualProvider}` : null, stats.visitEveryDays ? `every ${stats.visitEveryDays} days` : null].filter(Boolean).join(" · ") || undefined },
  ];

  const clientPhotos = await listGallery(business.id, { serviceId: null, categoryId: null, staffId: null, clientId, locationId: null, tag: null, periodDays: null, q: null, bothOnly: false, shareableOnly: false, page: 1 }, 6);
  const photoViews = pairViews(slug, clientPhotos.pairs, business.timezone);
  return (
    <>
      <div className="mb-2"><BackLink href={`/app/${slug}/clients`}>Clients</BackLink></div>
      <PageHeader title={`${client.firstName} ${client.lastName}`.trim()} lead={client.photoUrl ? /* eslint-disable-next-line @next/next/no-img-element */ <img src={client.photoUrl} alt="" className="h-10 w-10 rounded-full object-cover" /> : undefined}>
        {can(permissions, "appointments.write.any") ? <LinkButton href={`/app/${slug}/appointments/new?clientId=${client.id}`} variant="primary"><Plus className="h-4 w-4" /> Book appointment</LinkButton> : null}
      </PageHeader>
      {/* At a glance: the numbers the desk asks about before anything else. */}
      <Card className="mb-6 grid grid-cols-2 gap-px overflow-hidden bg-stone-100 sm:grid-cols-3 lg:grid-cols-5">
        {glance.map((g) => (
          <div key={g.label} className="bg-white px-4 py-3">
            <p className="text-xs uppercase tracking-wide text-stone-500">{g.label}</p>
            <p className="line-clamp-2 text-lg font-semibold leading-tight tabular-nums" title={g.value}>{g.value}</p>
            {g.hint ? <p className={`text-xs leading-4 ${g.tone === "warn" ? "text-amber-700" : "text-stone-500"}`}>{g.hint}</p> : null}
          </div>
        ))}
      </Card>
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
                    <Checkbox name="pinned" label="Pin to top" />
                    <NoteSubmit size="sm" variant="secondary" pendingText="Saving…">Add note</NoteSubmit>
                  </div>
                </ActionForm>
              </div>
            ) : null}
          </Card>
          {photoViews.length ? (
            <Card>
              <div className="flex items-center justify-between border-b border-stone-200 px-4 py-2">
                <h2 className="text-sm font-semibold text-stone-600">Photos</h2>
                <Link href={`/app/${slug}/gallery?client=${clientId}`} className="text-sm text-brand-700 underline">{clientPhotos.hasMore ? "See all" : "Open in Gallery"}</Link>
              </div>
              <ul className="grid gap-3 p-3 min-[420px]:grid-cols-2">{photoViews.map((v) => <li key={v.key}><PairCard pair={v} /></li>)}</ul>
            </Card>
          ) : null}
          <Card>
            <h2 className="border-b border-stone-200 px-4 py-2 text-sm font-semibold text-stone-600">Upcoming</h2>
            {upcoming.length === 0 ? <div className="p-4"><Empty title="Nothing booked" /></div> : (
              <ul className="divide-y divide-stone-100 text-sm">
                {upcoming.reverse().map((v) => (
                  <li key={v.id}><Link href={`/app/${slug}/appointments/${v.id}`} className="flex items-center justify-between px-4 py-2 hover:bg-stone-50"><span>{fmtDate.format(v.startAt)} · {formatTime(v.startAt, tz)} · {v.serviceName} with {v.staffName}{at(v)}</span><StatusBadge status={v.status} /></Link></li>
                ))}
              </ul>
            )}
          </Card>
          <Card>
            {timeline.length === 0 ? (
              <>
                <h2 className="border-b border-stone-200 px-4 py-2 text-sm font-semibold text-stone-600">History</h2>
                <div className="p-4"><Empty title="No past visits or purchases" /></div>
              </>
            ) : (
              <HistoryTimeline
                ratingCount={reviews.length}
                ratingAverage={reviewAverage}
                items={timeline.map((t) => ({
                  key: t.key,
                  when: fmtDate.format(t.at),
                  title: t.title,
                  meta: t.meta,
                  href: t.href,
                  status: t.status,
                  dim: t.kind === "visit" && (t.status === "cancelled" || t.status === "no_show"),
                  sale: t.sale ? { href: `/app/${slug}/sales/${t.sale.id}`, label: `${money(t.sale.totalCents)}${t.sale.status === "open" ? " due" : t.sale.status === "refunded" ? " refunded" : ""}`, open: t.sale.status === "open", title: `Ticket #${t.sale.number}` } : null,
                  review: t.review ? { rating: t.review.rating ?? 0, comment: t.review.comment } : null,
                }))}
              />
            )}
          </Card>
        </div>
        <div className="space-y-6">
          <Card className="p-4">
            <h2 className="mb-2 font-medium">Contact</h2>
            <div className="space-y-1 text-sm">
              {client.phone ? <p>{client.phone}{client.smsOptIn ? "" : <span className="ml-2 text-xs text-stone-400">no texts</span>}</p> : <p className="text-stone-400">No phone</p>}
              {client.email ? <p className="truncate">{client.email}{client.emailOptIn ? "" : <span className="ml-2 text-xs text-stone-400">no emails</span>}</p> : <p className="text-stone-400">No email</p>}
              {client.birthday ? <p className="text-stone-600">Birthday {client.birthday.slice(5).replace("-", "/")}</p> : null}
              {client.notes ? <p className="mt-2 rounded-md bg-amber-50 p-2 text-xs text-amber-900">{client.notes}</p> : null}
            </div>
            {write ? (
              <Disclosure variant="inset" title="Edit details" className="mt-3">
              <ActionForm action={updateClient}>
                <input type="hidden" name="slug" value={slug} />
                <input type="hidden" name="clientId" value={client.id} />
                <ImageField name="photo" removeName="removePhoto" current={client.photoUrl} shape="round" placeholder={client.firstName.slice(0, 1)} />
                <div className="grid grid-cols-2 gap-3">
                  <Field label="First name" name="firstName" required><Input name="firstName" defaultValue={client.firstName} required /></Field>
                  <Field label="Last name" name="lastName"><Input name="lastName" defaultValue={client.lastName} /></Field>
                </div>
                <Field label="Mobile phone" name="phone"><Input name="phone" type="tel" defaultValue={client.phone ?? ""} /></Field>
                <Field label="Email" name="email"><Input name="email" type="email" defaultValue={client.email ?? ""} /></Field>
                <Field label="Birthday" name="birthday" hint="For birthday messages."><Input name="birthday" type="date" defaultValue={client.birthday ?? ""} /></Field>
                <Field label="Notes" name="notes"><Textarea name="notes" rows={4} defaultValue={client.notes ?? ""} /></Field>
                {stopped ? (
                  <p className="text-xs text-stone-500">This number replied STOP, so nothing is texted to it. Texts come back on only if they text START.</p>
                ) : (
                  <Checkbox name="smsOptIn" defaultChecked={client.smsOptIn} label="Appointment texts (confirmations and reminders)" />
                )}
                <Checkbox name="emailOptIn" defaultChecked={client.emailOptIn} label="Appointment emails" />
                <Checkbox name="emailMarketingOptIn" defaultChecked={client.emailMarketingOptIn} label="Marketing emails" />
                {stopped ? null : (
                  <Checkbox
                    name="smsMarketingOptIn"
                    defaultChecked={client.smsMarketingOptIn}
                    label={client.smsMarketingOptIn && client.smsMarketingConsentAt ? `Marketing texts (agreed ${client.smsMarketingConsentAt.toLocaleDateString("en-US")}, ${client.smsMarketingConsentSource ?? "unknown"})` : "Marketing texts: the client agreed in writing (signed form, booking checkbox or their own text)"}
                  />
                )}
                <SubmitButton variant="secondary" pendingText="Saving…">Save</SubmitButton>
              </ActionForm>
              </Disclosure>
            ) : null}
          </Card>
          {storeCredit.balance > 0 || storeCredit.history.length > 0 || write ? (
            <Card className="p-4 text-sm">
              <h2 className="mb-1 font-medium">Store credit</h2>
              <p className="text-2xl font-semibold">{money(storeCredit.balance)}</p>
              <p className="text-xs text-stone-500">Spent at checkout like cash. Comes from refunds kept in-house, returned deposits and goodwill credits.</p>
              {storeCredit.history.length ? (
                <ul className="mt-2 max-h-32 space-y-0.5 overflow-y-auto text-xs text-stone-600">
                  {storeCredit.history.slice(0, 10).map((h) => (
                    <li key={h.id}>
                      {fmtDate.format(h.createdAt)} · <span className={h.deltaCents >= 0 ? "text-emerald-700" : "text-red-700"}>{h.deltaCents > 0 ? "+" : "−"}{money(Math.abs(h.deltaCents))}</span> · {({ refund: "refund as credit", deposit_refund: "deposit returned as credit", payment: "used at checkout", payment_refund: "refund of a credit payment", adjust: "adjustment" } as Record<string, string>)[h.reason] ?? h.reason}
                      {h.saleId ? <> · <Link href={`/app/${slug}/sales/${h.saleId}`} className="underline">sale</Link></> : null}{h.note ? ` · ${h.note}` : ""}
                    </li>
                  ))}
                </ul>
              ) : null}
              {write ? (
                <Disclosure variant="inset" title="Adjust store credit" className="mt-3">
                  <ActionForm action={adjustClientStoreCredit}>
                    <input type="hidden" name="slug" value={slug} />
                    <input type="hidden" name="clientId" value={client.id} />
                    <div className="grid grid-cols-[6rem_1fr] gap-2">
                      <Field label="Amount" name="amount" hint="Negative removes"><MoneyInput name="amount" /></Field>
                      <Field label="Reason" name="note"><Input name="note" placeholder="Goodwill after a late start" /></Field>
                    </div>
                    <SubmitButton size="sm" variant="secondary" pendingText="Saving…">Apply</SubmitButton>
                  </ActionForm>
                </Disclosure>
              ) : null}
            </Card>
          ) : null}
          {loyalty ? (
            <Card className="p-4 text-sm">
              <h2 className="mb-1 font-medium">Loyalty points</h2>
              <p className="text-2xl font-semibold">{loyalty.balance.toLocaleString()} <span className="text-sm font-normal text-stone-500">≈ {money(loyalty.balance * business.loyaltyPointValueCents)}</span></p>
              {loyalty.history.length ? (
                <ul className="mt-2 max-h-32 space-y-0.5 overflow-y-auto text-xs text-stone-600">
                  {loyalty.history.slice(0, 10).map((h) => <li key={h.id}>{fmtDate.format(h.createdAt)} · <span className={h.delta >= 0 ? "text-emerald-700" : "text-red-700"}>{h.delta > 0 ? "+" : ""}{h.delta}</span> · {h.reason}{h.note ? ` · ${h.note}` : ""}</li>)}
                </ul>
              ) : null}
              {write ? (
                <Disclosure variant="inset" title="Adjust points" className="mt-3">
                  <ActionForm action={adjustClientPoints}>
                    <input type="hidden" name="slug" value={slug} />
                    <input type="hidden" name="clientId" value={client.id} />
                    <div className="grid grid-cols-[6rem_1fr] gap-2">
                      <Field label="Adjust" name="delta"><Input name="delta" inputMode="numeric" placeholder="+50" /></Field>
                      <Field label="Reason" name="note"><Input name="note" placeholder="Birthday bonus" /></Field>
                    </div>
                    <SubmitButton size="sm" variant="secondary" pendingText="Saving…">Apply</SubmitButton>
                  </ActionForm>
                </Disclosure>
              ) : null}
              <div className="mt-3 border-t border-stone-200 pt-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="text-xs text-stone-500">Referral code</p>
                    {client.referralCode ? <p className="font-mono text-sm">{client.referralCode}</p> : write ? (
                      <form action={createReferralCode}><input type="hidden" name="slug" value={slug} /><input type="hidden" name="clientId" value={client.id} /><button className="text-xs text-brand-700 underline">Create a referral code</button></form>
                    ) : <p className="text-xs text-stone-400">None yet</p>}
                  </div>
                  {write ? (
                    <div className="flex gap-1">
                      {client.phone ? <form action={sendReferralCodeAction}><input type="hidden" name="slug" value={slug} /><input type="hidden" name="clientId" value={client.id} /><input type="hidden" name="channel" value="sms" /><Button type="submit" size="sm" variant="secondary">Text it</Button></form> : null}
                      {client.email ? <form action={sendReferralCodeAction}><input type="hidden" name="slug" value={slug} /><input type="hidden" name="clientId" value={client.id} /><input type="hidden" name="channel" value="email" /><Button type="submit" size="sm" variant="secondary">Email it</Button></form> : null}
                    </div>
                  ) : null}
                </div>
                <p className="mt-1 text-xs text-stone-500">{business.referralBonusPoints > 0 ? `${business.referralBonusPoints} points to them after each friend's first paid visit` : "No referrer bonus set"}{business.referralFriendBonusPoints > 0 ? ` · ${business.referralFriendBonusPoints} points to the friend` : ""}.</p>
                {referredBy ? <p className="mt-1 text-xs text-stone-500">Referred by <Link href={`/app/${slug}/clients/${referredBy.id}`} className="underline">{referredBy.name}</Link>{client.referralRewardedAt ? ` · bonus paid ${fmtDate.format(client.referralRewardedAt)}` : " · bonus after first paid visit"}</p> : null}
                <p className="mt-2 text-xs font-semibold uppercase tracking-wide text-stone-500">Referred {referrals.length ? `${referrals.length} ${referrals.length === 1 ? "client" : "clients"}` : "nobody yet"}</p>
                {referrals.length ? (
                  <ul className="mt-1 space-y-0.5 text-xs text-stone-600">
                    {referrals.map((r) => (
                      <li key={r.id} className="flex justify-between gap-2">
                        <Link href={`/app/${slug}/clients/${r.id}`} className="truncate underline">{r.name}</Link>
                        <span className="shrink-0 text-stone-500">{r.rewardedAt ? `first visit ${fmtDate.format(r.rewardedAt)} · bonus paid` : `joined ${fmtDate.format(r.joinedAt)} · not visited yet`}</span>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            </Card>
          ) : null}
          <Card className="p-4 text-sm">
            <h2 className="mb-2 font-medium">Text messages</h2>
            {thread.length === 0 ? <p className="text-stone-500">No texts yet.</p> : (
              <ul className="max-h-64 space-y-1.5 overflow-y-auto">
                {thread.map((m) => (
                  <li key={`${m.dir}${m.id}`} className={m.dir === "in" ? "mr-6" : "ml-6 text-right"}>
                    <span className={`inline-block rounded-lg px-2 py-1 text-left text-xs ${m.dir === "in" ? "bg-stone-100 text-stone-800" : "bg-brand-50 text-brand-900"}`}>{m.body}</span>
                    <span className="block text-[10px] text-stone-400">{fmtDate.format(m.at)} · {m.dir === "in" ? "client" : m.status}</span>
                  </li>
                ))}
              </ul>
            )}
            {write && client.phone ? (
              <Disclosure variant="inset" title={thread.length ? "Reply" : "Send a text"} open={thread.length > 0} className="mt-2">
                <ActionForm action={replyToClient}>
                  <input type="hidden" name="slug" value={slug} />
                  <input type="hidden" name="clientId" value={client.id} />
                  <Field label="" name="body"><Textarea name="body" rows={4} placeholder={client.smsOptIn ? "Reply by text…" : "Client opted out of texts"} disabled={!client.smsOptIn} /></Field>
                  <SubmitButton size="sm" variant="secondary" pendingText="Sending…" disabled={!client.smsOptIn}>Send text</SubmitButton>
                </ActionForm>
              </Disclosure>
            ) : null}
          </Card>
          <Card className="p-4 text-sm">
            <h2 className="mb-2 font-medium">Forms</h2>
            {submissions.length === 0 ? <p className="text-stone-500">Nothing signed yet.</p> : (
              <ul className="space-y-1">
                {submissions.map(({ s: sub, formName }) => <li key={sub.id} className={sub.voidedAt ? "text-stone-400 line-through" : ""}><Link href={`/app/${slug}/settings/forms/submissions/${sub.id}`} className="hover:underline">{formName}</Link> <span className="text-xs text-stone-500">· {fmtDate.format(sub.createdAt)}{sub.voidedAt ? " · voided" : sub.signatureName ? " · signed" : ""}{sub.assistedByUserId ? " · at the desk" : ""}</span></li>)}
              </ul>
            )}
            {write && activeForms.length ? (
              <p className="mt-2 text-xs text-stone-500">
                Complete here: {activeForms.map((f, i) => <span key={f.id}>{i ? " · " : ""}<Link href={`/app/${slug}/forms/fill/${f.id}?clientId=${client.id}`} className="text-brand-700 underline">{f.name}</Link></span>)}
              </p>
            ) : null}
          </Card>
          <Card className="p-4 text-sm">
            <h2 className="mb-2 font-medium">Packages &amp; memberships</h2>
            {packs.length === 0 && memberships.length === 0 ? <p className="text-stone-500">None.</p> : null}
            {packs.map((p) => <p key={p.id}>{p.name} · {p.remaining} session{p.remaining === 1 ? "" : "s"} left{p.expiresAt ? ` · expires ${fmtDate.format(p.expiresAt)}` : ""}</p>)}
            {memberships.map((m) => {
              const period = periodNoun(isMembershipInterval(m.interval) ? m.interval : "month", m.intervalCount);
              const frozen = m.status === "paused" && !!m.frozenUntil;
              const lastPeriod = !!m.cycleCount && m.cyclesBilled >= m.cycleCount;
              const live = m.status === "active" || m.status === "paused";
              const line = [
                m.name,
                frozen ? `frozen until ${fmtDate.format(m.frozenUntil!)}` : m.status === "paused" ? "paused" : m.status === "active" ? `${m.creditsRemaining} credit${m.creditsRemaining === 1 ? "" : "s"}` : m.status,
                live && !frozen ? (lastPeriod ? `ends ${fmtDate.format(m.currentPeriodEnd)}` : `${m.autoRenew ? "renews" : "period ends"} ${fmtDate.format(m.currentPeriodEnd)}`) : "",
                live ? `billed every ${period}${m.cycleCount ? ` · ${m.cyclesBilled} of ${m.cycleCount} paid` : ""}` : "",
              ].filter(Boolean).join(" · ");
              return (
                <div key={m.id} className="mt-1 rounded-lg border border-stone-200 p-2">
                  <p>{line}</p>
                  {m.paymentFailedAt && !frozen ? <p className="text-xs text-red-700">Last renewal payment failed {fmtDate.format(m.paymentFailedAt)}. Pick a card below to turn auto-renew on again.</p> : null}
                  {write && live ? (
                    <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
                      {frozen ? (
                        <form action={resumeMembershipAction}>
                          <input type="hidden" name="slug" value={slug} /><input type="hidden" name="clientId" value={client.id} /><input type="hidden" name="membershipId" value={m.id} />
                          <button className="text-xs underline">Resume now</button>
                        </form>
                      ) : m.status === "active" ? (
                        <form action={freezeMembershipAction} className="flex items-center gap-1 text-xs">
                          <input type="hidden" name="slug" value={slug} /><input type="hidden" name="clientId" value={client.id} /><input type="hidden" name="membershipId" value={m.id} />
                          <span>Freeze until</span>
                          <input type="date" name="until" required className="h-7 rounded-lg border border-stone-300 bg-white px-1.5 text-xs" />
                          <button className="underline">Freeze</button>
                        </form>
                      ) : null}
                      {m.autoRenew ? (
                        <form action={turnOffAutoRenew} className="flex gap-2">
                          <input type="hidden" name="slug" value={slug} /><input type="hidden" name="clientId" value={client.id} /><input type="hidden" name="membershipId" value={m.id} />
                          <button className="text-xs underline">Turn off auto-renew</button>
                          <ConfirmSubmit name="cancel" value="1" title="Cancel this membership?" body="Stops the renewal charges and ends the membership now." confirmLabel="Cancel membership" variant="ghost" className="text-xs">Cancel membership</ConfirmSubmit>
                        </form>
                      ) : frozen ? null : lastPeriod ? (
                        <span className="text-xs text-stone-500">Last period of a {m.cycleCount}-period plan; it ends on its own.</span>
                      ) : stripeReady && savedCards.length ? (
                        <form action={turnOnAutoRenew} className="flex flex-wrap items-center gap-2">
                          <input type="hidden" name="slug" value={slug} /><input type="hidden" name="clientId" value={client.id} /><input type="hidden" name="membershipId" value={m.id} />
                          <select name="paymentMethodId" className="h-8 rounded-lg border border-stone-300 bg-white px-2 text-xs">{savedCards.map((c) => <option key={c.id} value={c.id}>{c.brand.toUpperCase()} •••• {c.last4}</option>)}</select>
                          <button className="rounded-lg border border-stone-300 bg-white px-2 py-1 text-xs hover:bg-stone-50">Auto-renew with this card</button>
                        </form>
                      ) : <p className="text-xs text-stone-500">{stripeReady ? "Save a card at checkout to turn on auto-renew." : "Connect Stripe to auto-renew memberships."}</p>}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </Card>
          <p className="text-xs text-stone-400">Client since {fmtDate.format(client.createdAt)}{client.tags.length ? ` · ${client.tags.join(", ")}` : ""}</p>
        </div>
      </div>
    </>
  );
}
