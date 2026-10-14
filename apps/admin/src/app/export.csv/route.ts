import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { applyQuery, parseQuery, toCsv } from "@/lib/filters";
import { COOKIE, verifyToken } from "@/lib/session";
import { listTenantsWithBills } from "@/lib/tenants";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!verifyToken((await cookies()).get(COOKIE)?.value)) return new NextResponse("Unauthorized", { status: 401 });
  const query = parseQuery(Object.fromEntries(new URL(req.url).searchParams));
  const { tenants: all } = await listTenantsWithBills();
  const rows = applyQuery(all, query);
  const csv = toCsv([
    ["Business", "Slug", "Owner", "Plan", "Subscription", "Suspended", "Comped", "Custom pricing", "Locations", "Active staff", "Clients", "Appointments 30d", "Texts 30d", "Text number", "Est. monthly (USD)", "Last booking", "Signed up"],
    ...rows.map((t) => [t.name, t.slug, t.ownerEmail, t.plan, t.subscriptionStatus, t.suspendedAt ? "yes" : "", t.comped ? "yes" : "", t.hasOverrides ? "yes" : "", t.locations, t.activeStaff, t.clients, t.appointments30d, t.sms30d, t.hasNumber ? "yes" : "", (t.bill.totalCents / 100).toFixed(2), t.lastAppointmentAt, t.createdAt]),
  ]);
  return new NextResponse(csv, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="tenants-${new Date().toISOString().slice(0, 10)}.csv"` } });
}
