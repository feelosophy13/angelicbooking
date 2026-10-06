import { asc, eq } from "drizzle-orm";
import { schema, withTenant } from "@angelic/db";
import { can } from "@angelic/core";
import { requireBusiness } from "@/lib/tenant";
import { formatMoney } from "@/lib/utils";
import { Button, Card, Field, Input, PageHeader, Empty } from "@/components/ui";
import { createService, toggleServiceActive } from "./actions";

export default async function ServicesPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { business, role } = await requireBusiness(slug);
  const rows = await withTenant(business.id, (tx) =>
    tx
      .select({ s: schema.services, category: schema.serviceCategories.name })
      .from(schema.services)
      .leftJoin(schema.serviceCategories, eq(schema.serviceCategories.id, schema.services.categoryId))
      .orderBy(asc(schema.serviceCategories.sortOrder), asc(schema.serviceCategories.name), asc(schema.services.sortOrder), asc(schema.services.name)),
  );
  const manage = can(role, "services.manage");
  const groups = new Map<string, typeof rows>();
  for (const r of rows) {
    const k = r.category ?? "Uncategorised";
    groups.set(k, [...(groups.get(k) ?? []), r]);
  }

  return (
    <>
      <PageHeader title="Services" />
      <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
        <div className="space-y-4">
          {rows.length === 0 ? <Empty title="No services yet" body="Add your menu on the right." /> : null}
          {[...groups.entries()].map(([cat, list]) => (
            <Card key={cat}>
              <h2 className="border-b border-stone-200 px-4 py-2 text-sm font-semibold text-stone-600">{cat}</h2>
              <ul className="divide-y divide-stone-200">
                {list.map(({ s }) => (
                  <li key={s.id} className="flex items-center gap-3 px-4 py-3">
                    <div className="min-w-0 flex-1">
                      <p className={s.active ? "font-medium" : "font-medium text-stone-400 line-through"}>{s.name}</p>
                      <p className="text-xs text-stone-500">
                        {s.durationMin} min
                        {s.gapMin ? ` + ${s.gapMin} processing` : ""}
                        {s.finishMin ? ` + ${s.finishMin} finish` : ""}
                        {s.bufferAfterMin ? ` + ${s.bufferAfterMin} buffer` : ""}
                        {s.depositCents ? ` · deposit ${formatMoney(s.depositCents, business.currency)}` : ""}
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
        {manage ? (
          <Card className="p-4">
            <h2 className="mb-3 font-medium">Add service</h2>
            <form action={createService} className="space-y-3">
              <input type="hidden" name="slug" value={slug} />
              <Field label="Name"><Input name="name" required placeholder="Women's haircut" /></Field>
              <Field label="Category" hint="Typed freely; reused if it already exists."><Input name="categoryName" placeholder="Hair" /></Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Duration (min)"><Input name="durationMin" type="number" min={5} step={5} defaultValue={45} required /></Field>
                <Field label="Price"><Input name="price" inputMode="decimal" placeholder="65" required /></Field>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <Field label="Processing" hint="free gap"><Input name="gapMin" type="number" min={0} step={5} defaultValue={0} /></Field>
                <Field label="Finish" hint="after gap"><Input name="finishMin" type="number" min={0} step={5} defaultValue={0} /></Field>
                <Field label="Buffer" hint="clean-up"><Input name="bufferAfterMin" type="number" min={0} step={5} defaultValue={0} /></Field>
              </div>
              <Field label="Deposit (optional)"><Input name="deposit" inputMode="decimal" placeholder="0" /></Field>
              <Button type="submit" className="w-full">Add service</Button>
            </form>
          </Card>
        ) : null}
      </div>
    </>
  );
}
