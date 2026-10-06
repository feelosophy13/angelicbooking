import { asc, ilike, or } from "drizzle-orm";
import { schema, withTenant } from "@angelic/db";
import { can } from "@angelic/core";
import { requireBusiness } from "@/lib/tenant";
import { Button, Card, Field, Input, PageHeader, Textarea, Empty } from "@/components/ui";
import { createClient } from "./actions";

export default async function ClientsPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ q?: string }>;
}) {
  const { slug } = await params;
  const { q = "" } = await searchParams;
  const { business, role } = await requireBusiness(slug);
  const rows = await withTenant(business.id, (tx) => {
    const base = tx.select().from(schema.clients);
    const query = q.trim()
      ? base.where(
          or(
            ilike(schema.clients.firstName, `%${q}%`),
            ilike(schema.clients.lastName, `%${q}%`),
            ilike(schema.clients.phone, `%${q}%`),
            ilike(schema.clients.email, `%${q}%`),
          ),
        )
      : base;
    return query.orderBy(asc(schema.clients.lastName), asc(schema.clients.firstName)).limit(200);
  });

  return (
    <>
      <PageHeader title="Clients">
        <form className="flex gap-2">
          <Input name="q" defaultValue={q} placeholder="Search name, phone, email" className="w-64" />
          <Button type="submit" variant="secondary">Search</Button>
        </form>
      </PageHeader>
      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <Card>
          {rows.length === 0 ? (
            <div className="p-4"><Empty title={q ? "No matches" : "No clients yet"} /></div>
          ) : (
            <ul className="divide-y divide-stone-200">
              {rows.map((c) => (
                <li key={c.id} className="flex items-center gap-3 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">{c.firstName} {c.lastName}</p>
                    <p className="truncate text-xs text-stone-500">{[c.phone, c.email].filter(Boolean).join(" · ") || "no contact info"}</p>
                  </div>
                  {c.notes ? <span className="text-xs text-stone-400">note</span> : null}
                </li>
              ))}
            </ul>
          )}
        </Card>
        {can(role, "clients.write") ? (
          <Card className="p-4">
            <h2 className="mb-3 font-medium">Add client</h2>
            <form action={createClient} className="space-y-3">
              <input type="hidden" name="slug" value={slug} />
              <div className="grid grid-cols-2 gap-3">
                <Field label="First name"><Input name="firstName" required /></Field>
                <Field label="Last name"><Input name="lastName" /></Field>
              </div>
              <Field label="Phone"><Input name="phone" type="tel" /></Field>
              <Field label="Email"><Input name="email" type="email" /></Field>
              <Field label="Notes"><Textarea name="notes" rows={3} placeholder="Allergies, formulas, preferences" /></Field>
              <Button type="submit" className="w-full">Add client</Button>
            </form>
          </Card>
        ) : null}
      </div>
    </>
  );
}
