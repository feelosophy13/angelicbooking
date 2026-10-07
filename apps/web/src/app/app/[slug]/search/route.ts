import { NextResponse } from "next/server";
import { and, asc, eq, gte, ilike, or } from "drizzle-orm";
import { schema, withTenant } from "@angelic/db";
import { can } from "@angelic/core";
import { requireBusiness } from "@/lib/tenant";
import { dateTime } from "@/lib/format";

/** Backs the ⌘K palette. Returns up to ~15 hits across clients, appointments, services and pages. */
export async function GET(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { business, permissions } = await requireBusiness(slug);
  const q = (new URL(req.url).searchParams.get("q") ?? "").trim();
  const base = `/app/${slug}`;
  const pages = [
    { title: "Calendar", href: base }, { title: "New appointment", href: `${base}/appointments/new` }, { title: "Clients", href: `${base}/clients` }, { title: "New client", href: `${base}/clients/new` },
    { title: "Staff", href: `${base}/staff` }, { title: "Services", href: `${base}/services` }, { title: "Products", href: `${base}/products` }, { title: "Packages", href: `${base}/packages` },
    { title: "Gift cards", href: `${base}/gift-cards` }, { title: "Waitlist", href: `${base}/waitlist` }, { title: "Time clock", href: `${base}/time` },
    ...(can(permissions, "reports.view") ? [{ title: "Sales", href: `${base}/reports` }] : []),
    ...(can(permissions, "payroll.view") ? [{ title: "Payroll", href: `${base}/payroll` }] : []),
    ...(can(permissions, "business.manage") ? [{ title: "Settings", href: `${base}/settings` }, { title: "Online booking settings", href: `${base}/settings/booking` }, { title: "Roles & permissions", href: `${base}/settings/roles` }, { title: "Payments", href: `${base}/settings/payments` }] : []),
  ];
  const pageHits = pages.filter((p) => !q || p.title.toLowerCase().includes(q.toLowerCase())).slice(0, q ? 4 : 8).map((p) => ({ kind: "page" as const, title: p.title, href: p.href }));
  if (q.length < 2) return NextResponse.json({ hits: pageHits });

  const like = `%${q}%`;
  const { clients, appts, services } = await withTenant(business.id, async (tx) => {
    const clients = can(permissions, "clients.read")
      ? await tx.select().from(schema.clients).where(or(ilike(schema.clients.firstName, like), ilike(schema.clients.lastName, like), ilike(schema.clients.phone, like), ilike(schema.clients.email, like))).orderBy(asc(schema.clients.lastName)).limit(5)
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
