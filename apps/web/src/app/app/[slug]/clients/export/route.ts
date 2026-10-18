import { PermissionError, requireActions } from "@/lib/tenant";
import { listClients } from "@/server/clients";
import { csvResponse } from "@/lib/csv";
import { auditEvent } from "@/lib/audit";

/** The whole client list as a file. Its own permission (clients.export), and every download is in the activity log, like pay sheets. */
export async function GET(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  // A file download has no error boundary to land on, so the refusal is a plain 403 with the same words the app shows.
  const ctx = await requireActions(slug, "clients.read", "clients.export").catch((e: unknown) => (e instanceof PermissionError ? null : Promise.reject(e)));
  if (!ctx) return new Response(new PermissionError().message, { status: 403, headers: { "Content-Type": "text/plain; charset=utf-8" } });
  const { business, user } = ctx;
  const q = new URL(req.url).searchParams.get("q") ?? undefined;
  const locationId = new URL(req.url).searchParams.get("location") || null;
  const all: Awaited<ReturnType<typeof listClients>>["rows"] = [];
  for (let page = 1; ; page++) {
    const r = await listClients(business.id, { q, page, pageSize: 200, sort: "name", locationId });
    all.push(...r.rows);
    if (page >= r.pages) break;
  }
  await auditEvent(business.id, user.id, "clients.export", "clients", null, { q: q ?? null, locationId, rows: all.length });
  const d = (x: Date | null) => (x ? x.toISOString().slice(0, 10) : "");
  return csvResponse(
    `clients-${business.slug}-${new Date().toISOString().slice(0, 10)}.csv`,
    ["First name", "Last name", "Phone", "Email", "Home location", "Client since", "Last visit", "Visits", "No-shows", "Lifetime spend", "Notes"],
    all.map((c) => [c.firstName, c.lastName, c.phone, c.email, c.homeLocationName, d(c.createdAt), d(c.lastVisit), Number(c.visitCount), Number(c.noShows), (Number(c.spend) / 100).toFixed(2), c.notes]),
  );
}
