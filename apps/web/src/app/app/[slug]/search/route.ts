import { NextResponse } from "next/server";
import { and, asc, desc, eq, gte, ilike, or, sql } from "drizzle-orm";
import { schema, withTenant } from "@angelic/db";
import { can } from "@angelic/core";
import { requireBusiness } from "@/lib/tenant";
import { seesOwnOnly } from "@/lib/appointment-access";
import { canSeeClientContact } from "@/lib/visibility";
import { clientSearchWhere } from "@/server/clients";
import { dateTime } from "@/lib/format";
import { searchPages } from "@/lib/nav";

/** Backs the ⌘K palette. Returns up to ~20 hits across clients, appointments (by client or service, recent past and upcoming), services and pages. */
function nameOfClient(clients: { id: string; firstName: string; lastName: string | null }[], id: string | null) {
  const c = clients.find((x) => x.id === id);
  return c ? `${c.firstName} ${c.lastName ?? ""}`.trim() : "Walk-in";
}
export async function GET(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { business, permissions, staffId } = await requireBusiness(slug);
  const q = (new URL(req.url).searchParams.get("q") ?? "").trim();
  const base = `/app/${slug}`;
  const pages = searchPages(base, permissions, staffId ?? null);
  const ql = q.toLowerCase();
  // Title matches first, then keyword matches (section name, settings blurb).
  const pageHits = [...pages.filter((p) => !q || p.title.toLowerCase().includes(ql)), ...(q ? pages.filter((p) => !p.title.toLowerCase().includes(ql) && p.keywords?.toLowerCase().includes(ql)) : [])].slice(0, q ? 5 : 8).map((p) => ({ kind: "page" as const, title: p.title, href: p.href }));
  if (q.length < 2) return NextResponse.json({ hits: pageHits });

  const like = `%${q}%`;
  const { clients, appts, services } = await withTenant(business.id, async (tx) => {
    const clients = can(permissions, "clients.read")
      ? await tx.select({ id: schema.clients.id, firstName: schema.clients.firstName, lastName: schema.clients.lastName, phone: schema.clients.phone, email: schema.clients.email }).from(schema.clients).where(clientSearchWhere(q)).orderBy(asc(schema.clients.lastName)).limit(5)
      : [];
    // Appointments: the matched clients' visits from the last 90 days onward (past ones too, so "when did Ella last come in" works),
    // and upcoming visits whose service name matches ("who has a lash lift this week"). Own-calendar roles see only their own.
    const mine = seesOwnOnly(permissions) && staffId ? eq(schema.appointmentItems.staffId, staffId) : can(permissions, "appointments.read.any") ? undefined : sql`false`;
    const since = new Date(Date.now() - 90 * 86_400_000);
    const byClient = clients.length
      ? await tx
          .select({ id: schema.appointments.id, startAt: schema.appointmentItems.startAt, service: schema.appointmentItems.serviceName, clientId: schema.appointments.clientId, status: schema.appointments.status })
          .from(schema.appointments)
          .innerJoin(schema.appointmentItems, and(eq(schema.appointmentItems.appointmentId, schema.appointments.id), eq(schema.appointmentItems.sortOrder, 0)))
          .where(and(or(...clients.map((c) => eq(schema.appointments.clientId, c.id))), gte(schema.appointmentItems.startAt, since), eq(schema.appointments.kind, "visit"), mine))
          .orderBy(desc(schema.appointmentItems.startAt))
          .limit(6)
      : [];
    const byService = await tx
      .select({ id: schema.appointments.id, startAt: schema.appointmentItems.startAt, service: schema.appointmentItems.serviceName, clientId: schema.appointments.clientId, status: schema.appointments.status, firstName: schema.clients.firstName, lastName: schema.clients.lastName })
      .from(schema.appointmentItems)
      .innerJoin(schema.appointments, eq(schema.appointments.id, schema.appointmentItems.appointmentId))
      .leftJoin(schema.clients, eq(schema.clients.id, schema.appointments.clientId))
      .where(and(ilike(schema.appointmentItems.serviceName, like), gte(schema.appointmentItems.startAt, new Date()), eq(schema.appointments.kind, "visit"), sql`${schema.appointmentItems.status} <> 'cancelled'`, mine))
      .orderBy(asc(schema.appointmentItems.startAt))
      .limit(5);
    const seen = new Set<string>();
    const appts = [...byClient.map((a) => ({ ...a, who: nameOfClient(clients, a.clientId) })), ...byService.map((a) => ({ ...a, who: a.firstName ? `${a.firstName} ${a.lastName ?? ""}`.trim() : "Walk-in" }))].filter((a) => (seen.has(a.id) ? false : (seen.add(a.id), true)));
    const services = can(permissions, "catalog.view") ? await tx.select().from(schema.services).where(and(eq(schema.services.active, true), ilike(schema.services.name, like))).limit(4) : [];
    return { clients, appts, services };
  });
  const hits = [
    // Phone and email under a hit need "See phone, email, address and birthday" (C1).
    ...clients.map((c) => ({ kind: "client" as const, title: `${c.firstName} ${c.lastName}`.trim(), subtitle: canSeeClientContact(permissions) ? [c.phone, c.email].filter(Boolean).join(" · ") : "", href: `${base}/clients/${c.id}` })),
    ...appts.map((a) => ({ kind: "appointment" as const, title: `${a.who} · ${a.service}`, subtitle: `${dateTime(a.startAt, business.timezone)}${a.startAt < new Date() ? " · past" : ""}${a.status === "cancelled" ? " · cancelled" : a.status === "no_show" ? " · no-show" : ""}`, href: `${base}/appointments/${a.id}` })),
    ...services.map((s) => ({ kind: "service" as const, title: s.name, subtitle: `${s.durationMin} min`, href: can(permissions, "services.manage") ? `${base}/services/${s.id}` : `${base}/services` })),
    ...pageHits,
  ];
  return NextResponse.json({ hits });
}
