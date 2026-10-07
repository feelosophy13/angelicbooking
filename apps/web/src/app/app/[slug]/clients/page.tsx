import Link from "next/link";
import type { Metadata } from "next";
import { ChevronRight, Plus, Search } from "lucide-react";

export const metadata: Metadata = { title: "Clients" };
import { asc, ilike, or } from "drizzle-orm";
import { schema, withTenant } from "@angelic/db";
import { can } from "@angelic/core";
import { requireBusiness } from "@/lib/tenant";
import { Button, Card, Input, LinkButton, PageHeader, Empty } from "@/components/ui";

export default async function ClientsPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ q?: string }> }) {
  const { slug } = await params;
  const { q = "" } = await searchParams;
  const { business, role } = await requireBusiness(slug);
  const rows = await withTenant(business.id, (tx) => {
    const base = tx.select().from(schema.clients);
    const query = q.trim()
      ? base.where(or(ilike(schema.clients.firstName, `%${q}%`), ilike(schema.clients.lastName, `%${q}%`), ilike(schema.clients.phone, `%${q}%`), ilike(schema.clients.email, `%${q}%`)))
      : base;
    return query.orderBy(asc(schema.clients.lastName), asc(schema.clients.firstName)).limit(200);
  });
  return (
    <>
      <PageHeader title="Clients">
        <form className="flex gap-2">
          <Input name="q" defaultValue={q} placeholder="Search name, phone, email" className="w-64" />
          <Button type="submit" variant="secondary" aria-label="Search"><Search className="h-4 w-4" /></Button>
        </form>
        {can(role, "clients.write") ? <LinkButton href={`/app/${slug}/clients/new`} variant="primary"><Plus className="h-4 w-4" /> New client</LinkButton> : null}
      </PageHeader>
      <Card>
        {rows.length === 0 ? (
          <div className="p-4"><Empty title={q ? "No matches" : "No clients yet"} body={q ? "Try a different name, phone or email." : "Clients are added when they book online, or you can add them here."} action={q ? undefined : { href: `/app/${slug}/clients/new`, label: "Add a client" }} /></div>
        ) : (
          <ul className="divide-y divide-stone-200">
            {rows.map((c) => (
              <li key={c.id}>
                <Link href={`/app/${slug}/clients/${c.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-stone-50">
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">{c.firstName} {c.lastName}</p>
                    <p className="truncate text-xs text-stone-500">{[c.phone, c.email].filter(Boolean).join(" · ") || "no contact info"}</p>
                  </div>
                  {c.notes ? <span className="text-xs text-stone-400">note</span> : null}
                  <ChevronRight className="h-4 w-4 text-stone-300" />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
