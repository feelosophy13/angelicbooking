import { requireAction } from "@/lib/tenant";
import { listClients } from "@/server/clients";
import { csvResponse } from "@/lib/csv";

export async function GET(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { business } = await requireAction(slug, "clients.read");
  const q = new URL(req.url).searchParams.get("q") ?? undefined;
  const all: Awaited<ReturnType<typeof listClients>>["rows"] = [];
  for (let page = 1; ; page++) {
    const r = await listClients(business.id, { q, page, pageSize: 200, sort: "name" });
    all.push(...r.rows);
    if (page >= r.pages) break;
  }
  const d = (x: Date | null) => (x ? x.toISOString().slice(0, 10) : "");
  return csvResponse(
    `clients-${business.slug}-${new Date().toISOString().slice(0, 10)}.csv`,
    ["First name", "Last name", "Phone", "Email", "Client since", "Last visit", "Visits", "No-shows", "Lifetime spend", "Notes"],
    all.map((c) => [c.firstName, c.lastName, c.phone, c.email, d(c.createdAt), d(c.lastVisit), Number(c.visitCount), Number(c.noShows), (Number(c.spend) / 100).toFixed(2), c.notes]),
  );
}
