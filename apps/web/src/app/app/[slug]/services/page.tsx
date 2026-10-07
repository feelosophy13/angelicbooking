import Link from "next/link";
import type { Metadata } from "next";
import { ChevronDown, ChevronUp, Plus } from "lucide-react";

export const metadata: Metadata = { title: "Services" };
import { asc, eq } from "drizzle-orm";
import { schema, withTenant } from "@angelic/db";
import { can } from "@angelic/core";
import { requireBusiness } from "@/lib/tenant";
import { formatMoney } from "@/lib/utils";
import { duration } from "@/lib/format";
import { Button, Card, LinkButton, PageHeader, Empty } from "@/components/ui";
import { moveService, toggleServiceActive } from "./actions";

export default async function ServicesPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { business, permissions } = await requireBusiness(slug);
  const rows = await withTenant(business.id, (tx) =>
    tx
      .select({ s: schema.services, category: schema.serviceCategories.name })
      .from(schema.services)
      .leftJoin(schema.serviceCategories, eq(schema.serviceCategories.id, schema.services.categoryId))
      .orderBy(asc(schema.serviceCategories.sortOrder), asc(schema.serviceCategories.name), asc(schema.services.sortOrder), asc(schema.services.name)),
  );
  const manage = can(permissions, "services.manage");
  const groups = new Map<string, typeof rows>();
  for (const r of rows) {
    const k = r.category ?? "Uncategorised";
    groups.set(k, [...(groups.get(k) ?? []), r]);
  }
  return (
    <>
      <PageHeader title="Services">
        {manage ? <LinkButton href={`/app/${slug}/services/categories`}>Categories</LinkButton> : null}
        {manage ? <LinkButton href={`/app/${slug}/services/new`} variant="primary"><Plus className="h-4 w-4" /> New service</LinkButton> : null}
      </PageHeader>
      <div className="space-y-4">
        {rows.length === 0 ? <Empty title="No services yet" body="Your menu is what clients see when they book." action={{ href: `/app/${slug}/services/new`, label: "Add your first service" }} /> : null}
        {[...groups.entries()].map(([cat, list]) => (
          <Card key={cat}>
            <h2 className="border-b border-stone-200 px-4 py-2 text-sm font-semibold text-stone-600">{cat}</h2>
            <ul className="divide-y divide-stone-200">
              {list.map(({ s }, idx) => (
                <li key={s.id} className="flex items-center gap-3 px-4 py-3">
                  {manage && list.length > 1 ? (
                    <div className="flex flex-col -my-1">
                      <form action={moveService}><input type="hidden" name="slug" value={slug} /><input type="hidden" name="serviceId" value={s.id} /><input type="hidden" name="dir" value="up" /><button aria-label={`Move ${s.name} up`} disabled={idx === 0} className="rounded p-0.5 text-stone-400 hover:text-stone-700 disabled:opacity-30"><ChevronUp className="h-3.5 w-3.5" /></button></form>
                      <form action={moveService}><input type="hidden" name="slug" value={slug} /><input type="hidden" name="serviceId" value={s.id} /><input type="hidden" name="dir" value="down" /><button aria-label={`Move ${s.name} down`} disabled={idx === list.length - 1} className="rounded p-0.5 text-stone-400 hover:text-stone-700 disabled:opacity-30"><ChevronDown className="h-3.5 w-3.5" /></button></form>
                    </div>
                  ) : null}
                  <div className="min-w-0 flex-1">
                    {manage ? (
                      <Link href={`/app/${slug}/services/${s.id}`} className={`font-medium hover:underline ${s.active ? "" : "text-stone-400 line-through"}`}>{s.name}</Link>
                    ) : (
                      <p className={s.active ? "font-medium" : "font-medium text-stone-400 line-through"}>{s.name}</p>
                    )}
                    <p className="text-xs text-stone-500">
                      {duration(s.durationMin)}
                      {s.gapMin ? ` + ${duration(s.gapMin)} processing` : ""}
                      {s.finishMin ? ` + ${duration(s.finishMin)} finish` : ""}
                      {s.bufferAfterMin ? ` + ${duration(s.bufferAfterMin)} buffer` : ""}
                      {s.depositCents ? ` · deposit ${formatMoney(s.depositCents, business.currency)}` : ""}
                      {!s.bookableOnline ? " · not online" : ""}
                    </p>
                  </div>
                  <span className="font-medium">{formatMoney(s.priceCents, business.currency)}</span>
                  {manage ? (
                    <form action={toggleServiceActive}>
                      <input type="hidden" name="slug" value={slug} />
                      <input type="hidden" name="serviceId" value={s.id} />
                      <input type="hidden" name="active" value={s.active ? "false" : "true"} />
                      <Button size="sm" variant="ghost" type="submit">{s.active ? "Hide" : "Show"}</Button>
                    </form>
                  ) : null}
                </li>
              ))}
            </ul>
          </Card>
        ))}
      </div>
    </>
  );
}
