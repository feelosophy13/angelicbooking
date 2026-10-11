import { NextResponse } from "next/server";
import { and, asc, eq, gte, ilike, or } from "drizzle-orm";
import { schema, withTenant } from "@angelic/db";
import { can } from "@angelic/core";
import { requireBusiness } from "@/lib/tenant";
import { clientSearchWhere } from "@/server/clients";
import { dateTime } from "@/lib/format";
import { searchPages } from "@/lib/nav";

/** Backs the ⌘K palette. Returns up to ~15 hits across clients, appointments, services and pages. */
export async function GET(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { business, permissions } = await requireBusiness(slug);
  const q = (new URL(req.url).searchParams.get("q") ?? "").trim();
  const base = `/app/${slug}`;
  const pages = searchPages(base, permissions);
  const ql = q.toLowerCase();
  // Title matches first, then keyword matches (section name, settings blurb).
  const pageHits = [...pages.filter((p) => !q || p.title.toLowerCase().includes(ql)), ...(q ? pages.filter((p) => !p.title.toLowerCase().includes(ql) && p.keywords?.toLowerCase().includes(ql)) : [])].slice(0, q ? 5 : 8).map((p) => ({ kind: "page" as const, title: p.title, href: p.href }));
  if (q.length < 2) return NextResponse.json({ hits: pageHits });

  const like = `%${q}%`;
  const { clients, appts, services } = await withTenant(business.id, async (tx) => {
    const clients = can(permissions, "clients.read")
      ? await tx.select({ id: schema.clients.id, firstName: schema.clients.firstName, lastName: schema.clients.lastName, phone: schema.clients.phone, email: schema.clients.email }).from(schema.clients).where(clientSearchWhere(q)).orderBy(asc(schema.clients.lastName)).limit(5)
      : [];
    const appts = clients.length && can(permissions, "appointments.read.any")
      ? await tx
          .select({ id: schema.appointments.id, startAt: schema.appointmentItems.startAt, service: schema.appointmentItems.serviceName, clientId: schema.appointments.clientId, status: schema.appointments.status })
          .from(schema.appointments)
          .innerJoin(schema.appointmentItems, and(eq(schema.appointmentItems.appointmentId, schema.appointments.id), eq(schema.appointmentItems.sortOrder, 0)))
          .where(and(or(...clients.map((c) => eq(schema.appointments.clientId, c.id))), gte(schema.appointmentItems.startAt, new Date(Date.now() - 86_400_000))))
          .orderBy(asc(schema.appointmentItems.startAt))
          .limit(5)
      : [];
    const services = await tx.select().from(schema.services).where(and(eq(schema.services.active, true), ilike(schema.services.name, like))).limit(4);
    return { clients, appts, services };
  });
  const nameOf = (id: string | null) => {
    const c = clients.find((x) => x.id === id);
    return c ? `${c.firstName} ${c.lastName}`.trim() : "Walk-in";
  };
  const hits = [
    ...clients.map((c) => ({ kind: "client" as const, title: `${c.firstName} ${c.lastName}`.trim(), subtitle: [c.phone, c.email].filter(Boolean).join(" · "), href: `${base}/clients/${c.id}` })),
    ...appts.map((a) => ({ kind: "appointment" as const, title: `${nameOf(a.clientId)} · ${a.service}`, subtitle: dateTime(a.startAt, business.timezone), href: `${base}/appointments/${a.id}` })),
    ...services.map((s) => ({ kind: "service" as const, title: s.name, subtitle: `${s.durationMin} min`, href: can(permissions, "services.manage") ? `${base}/services/${s.id}` : `${base}/services` })),
    ...pageHits,
  ];
  return NextResponse.json({ hits });
}
