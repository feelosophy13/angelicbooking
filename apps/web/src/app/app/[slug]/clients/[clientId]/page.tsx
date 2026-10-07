import Link from "next/link";
import { notFound } from "next/navigation";
import { and, asc, desc, eq, gt, isNull, or } from "drizzle-orm";
import { schema, withTenant } from "@angelic/db";
import { can } from "@angelic/core";
import { requireBusiness } from "@/lib/tenant";
import { formatMoney, formatTime } from "@/lib/utils";
import { Button, Card, Field, Input, LinkButton, PageHeader, Textarea, Empty } from "@/components/ui";
import { updateClient } from "../actions";

export default async function ClientPage({ params }: { params: Promise<{ slug: string; clientId: string }> }) {
  const { slug, clientId } = await params;
  const { business, role } = await requireBusiness(slug);
  const data = await withTenant(business.id, async (tx) => {
    const client = await tx.query.clients.findFirst({ where: eq(schema.clients.id, clientId) });
    if (!client) return null;
    const now = new Date();
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
    return { client, visits, sales, packs, memberships };
  });
  if (!data) notFound();
  const { client, visits, sales, packs, memberships } = data;
  const tz = business.timezone;
  const fmtDate = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeZone: tz });
  const done = new Set(["cancelled", "completed", "no_show"]);
  const upcoming = visits.filter((v) => v.startAt >= new Date() && !done.has(v.status));
  const past = visits.filter((v) => v.startAt < new Date() || done.has(v.status));
  const money = (c: number) => formatMoney(c, business.currency);
  const write = can(role, "clients.write");

  return (
    <>
      <PageHeader title={`${client.firstName} ${client.lastName}`.trim()}>
        <Link href={`/app/${slug}/clients`} className="text-sm text-brand-700 underline">← Clients</Link>
        {can(role, "appointments.write.any") ? <LinkButton href={`/app/${slug}/appointments/new?clientId=${client.id}`} variant="primary">+ Book appointment</LinkButton> : null}
      </PageHeader>
      <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
        <div className="space-y-6">
          <Card>
            <h2 className="border-b border-stone-200 px-4 py-2 text-sm font-semibold text-stone-600">Upcoming</h2>
            {upcoming.length === 0 ? <div className="p-4"><Empty title="Nothing booked" /></div> : (
              <ul className="divide-y divide-stone-100 text-sm">
                {upcoming.reverse().map((v) => (
                  <li key={v.id}><Link href={`/app/${slug}/appointments/${v.id}`} className="flex items-center justify-between px-4 py-2 hover:bg-stone-50"><span>{fmtDate.format(v.startAt)} · {formatTime(v.startAt, tz)} · {v.serviceName} with {v.staffName}</span><span className="text-xs uppercase text-stone-500">{v.status.replace("_", " ")}</span></Link></li>
                ))}
              </ul>
            )}
          </Card>
          <Card>
            <h2 className="border-b border-stone-200 px-4 py-2 text-sm font-semibold text-stone-600">History</h2>
            {past.length === 0 ? <div className="p-4"><Empty title="No past visits" /></div> : (
              <ul className="divide-y divide-stone-100 text-sm">
                {past.map((v) => (
                  <li key={v.id}><Link href={`/app/${slug}/appointments/${v.id}`} className="flex items-center justify-between px-4 py-2 hover:bg-stone-50"><span className={v.status === "cancelled" || v.status === "no_show" ? "text-stone-400" : ""}>{fmtDate.format(v.startAt)} · {v.serviceName} with {v.staffName}</span><span className="text-xs uppercase text-stone-500">{v.status.replace("_", " ")}</span></Link></li>
                ))}
              </ul>
            )}
          </Card>
          <Card>
            <h2 className="border-b border-stone-200 px-4 py-2 text-sm font-semibold text-stone-600">Sales</h2>
            {sales.length === 0 ? <div className="p-4"><Empty title="No sales yet" /></div> : (
              <ul className="divide-y divide-stone-100 text-sm">
                {sales.map((s) => (
                  <li key={s.id}><Link href={`/app/${slug}/sales/${s.id}`} className="flex items-center justify-between px-4 py-2 hover:bg-stone-50"><span>#{s.number} · {fmtDate.format(s.createdAt)}</span><span>{money(s.totalCents)} <span className="text-xs uppercase text-stone-500">{s.status}</span></span></Link></li>
                ))}
              </ul>
            )}
          </Card>
        </div>
        <div className="space-y-6">
          <Card className="p-4">
            <h2 className="mb-3 font-medium">Details</h2>
            {write ? (
              <form action={updateClient} className="space-y-3">
                <input type="hidden" name="slug" value={slug} />
                <input type="hidden" name="clientId" value={client.id} />
                <div className="grid grid-cols-2 gap-3">
                  <Field label="First name"><Input name="firstName" defaultValue={client.firstName} required /></Field>
                  <Field label="Last name"><Input name="lastName" defaultValue={client.lastName} /></Field>
                </div>
                <Field label="Mobile phone"><Input name="phone" type="tel" defaultValue={client.phone ?? ""} /></Field>
                <Field label="Email"><Input name="email" type="email" defaultValue={client.email ?? ""} /></Field>
                <Field label="Notes"><Textarea name="notes" rows={4} defaultValue={client.notes ?? ""} /></Field>
                <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="smsOptIn" defaultChecked={client.smsOptIn} className="h-4 w-4 accent-brand-600" /> Text messages</label>
                <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="emailOptIn" defaultChecked={client.emailOptIn} className="h-4 w-4 accent-brand-600" /> Emails</label>
                <Button type="submit" variant="secondary">Save</Button>
              </form>
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
