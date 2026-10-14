import type { Metadata } from "next";
import { eq } from "drizzle-orm";
import { schema, withTenant } from "@angelic/db";
import { requireAction } from "@/lib/tenant";
import { listLocations, loggableProducts, recentUsage, recentlyLoggedBy } from "@/server/inventory";
import { productLabel } from "@/lib/inventory";
import { Card } from "@/components/ui";
import { UsageSearch } from "./usage-search";

export const metadata: Metadata = { title: "Log usage · Inventory" };

/** Where a stylist logs the supplies they used: search for the product, press Log. For a particular client's visit, the appointment page has the same thing. */
export default async function LogUsagePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const ctx = await requireAction(slug, "inventory.log");
  const { business } = ctx;
  const [products, locations, recent, mine] = await Promise.all([loggableProducts(business.id), listLocations(business.id), recentUsage(business.id, 10), recentlyLoggedBy(business.id, ctx.user.id)]);
  const myLocation = ctx.staffId ? (await withTenant(business.id, (tx) => tx.query.staff.findFirst({ where: eq(schema.staff.id, ctx.staffId!), columns: { locationId: true } })))?.locationId : null;
  const defaultLocationId = locations.find((l) => l.id === myLocation)?.id ?? locations.find((l) => l.isDefault)?.id ?? locations[0]!.id;
  const short = (n: string) => n.replace(`${business.name} - `, "");
  const fmt = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: business.timezone });
  return (
    <div className="max-w-2xl space-y-5">
      <p className="text-sm text-stone-600">Log a product each time you use up a unit (open a new tube, finish a pack). Whole units only. It comes off the stock at the location you pick.</p>
      <UsageSearch
        slug={slug}
        products={products.map((p) => ({ id: p.id, label: productLabel(p), category: p.category, kind: p.kind, onHand: p.onHand, tracked: p.tracked }))}
        recentIds={mine}
        locations={locations.map((l) => ({ id: l.id, name: short(l.name) }))}
        defaultLocationId={defaultLocationId}
      />
      {recent.length ? (
        <Card>
          <h2 className="border-b border-stone-200 px-4 py-2 text-sm font-semibold text-stone-600">Logged by the team, recently</h2>
          <ul className="divide-y divide-stone-100 text-sm">
            {recent.map((m) => (
              <li key={m.id} className="flex items-center justify-between gap-3 px-4 py-2">
                <span className="min-w-0 truncate">{m.label} <span className="text-stone-500">× {Math.abs(m.delta)}{m.delta > 0 ? " taken back" : ""}{locations.length > 1 && m.location ? ` · ${short(m.location)}` : ""}</span></span>
                <span className="shrink-0 text-xs text-stone-500">{m.who ?? ""} · {fmt.format(m.createdAt)}</span>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
    </div>
  );
}
