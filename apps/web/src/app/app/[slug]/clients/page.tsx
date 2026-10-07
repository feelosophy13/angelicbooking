import Link from "next/link";
import type { Metadata } from "next";
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, Download, Plus, Search } from "lucide-react";
import { can } from "@angelic/core";
import { requireBusiness } from "@/lib/tenant";
import { listClients, type ClientSort } from "@/server/clients";
import { dateShort, money } from "@/lib/format";
import { Button, Card, Input, LinkButton, PageHeader, Empty } from "@/components/ui";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Clients" };

const SORTS: { key: ClientSort; label: string; align?: "right" }[] = [
  { key: "name", label: "Client" },
  { key: "last_visit", label: "Last visit" },
  { key: "spend", label: "Lifetime spend", align: "right" },
  { key: "created", label: "Client since" },
];

export default async function ClientsPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ q?: string; sort?: string; dir?: string; page?: string }> }) {
  const { slug } = await params;
  const sp = await searchParams;
  const { business, permissions } = await requireBusiness(slug);
  const q = sp.q ?? "";
  const sort = (SORTS.some((s) => s.key === sp.sort) ? sp.sort : "name") as ClientSort;
  const dir = sp.dir === "desc" ? "desc" : sp.dir === "asc" ? "asc" : sort === "name" || sort === "created" ? "asc" : "desc";
  const page = Math.max(1, Number(sp.page) || 1);
  const r = await listClients(business.id, { q, sort, dir, page });
  const link = (extra: Record<string, string | number | undefined>) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries({ q: q || undefined, sort, dir, page, ...extra })) if (v !== undefined && v !== "") p.set(k, String(v));
    return `?${p.toString()}`;
  };
  const sortLink = (key: ClientSort) => link({ sort: key, dir: sort === key ? (dir === "asc" ? "desc" : "asc") : key === "name" || key === "created" ? "asc" : "desc", page: 1 });

  return (
    <>
      <PageHeader title="Clients">
        <form className="flex gap-2">
          <Input name="q" defaultValue={q} placeholder="Search name, phone, email" className="w-64" />
          <Button type="submit" variant="secondary" aria-label="Search"><Search className="h-4 w-4" /></Button>
        </form>
        <LinkButton href={`/app/${slug}/clients/export${q ? `?q=${encodeURIComponent(q)}` : ""}`}><Download className="h-4 w-4" /> CSV</LinkButton>
        {can(permissions, "clients.write") ? <LinkButton href={`/app/${slug}/clients/new`} variant="primary"><Plus className="h-4 w-4" /> New client</LinkButton> : null}
      </PageHeader>
      <Card>
        {r.rows.length === 0 ? (
          <div className="p-4"><Empty title={q ? "No matches" : "No clients yet"} body={q ? "Try a different name, phone or email." : "Clients are added when they book online, or you can add them here."} action={q ? undefined : { href: `/app/${slug}/clients/new`, label: "Add a client" }} /></div>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase tracking-wide text-stone-500">
              <tr>
                {SORTS.map((s) => (
                  <th key={s.key} className={cn("px-4 py-2 font-semibold", s.align === "right" && "text-right")}>
                    <Link href={sortLink(s.key)} className={cn("inline-flex items-center gap-1 hover:text-stone-800", sort === s.key && "text-stone-900")}>
                      {s.label}
                      {sort === s.key ? dir === "asc" ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" /> : null}
                    </Link>
                  </th>
                ))}
                <th className="px-4 py-2 text-right font-semibold">Visits</th>
                <th />
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {r.rows.map((c) => (
                <tr key={c.id} className="hover:bg-stone-50">
                  <td className="px-4 py-2">
                    <Link href={`/app/${slug}/clients/${c.id}`} className="font-medium hover:underline">{c.firstName} {c.lastName}</Link>
                    <p className="truncate text-xs text-stone-500">{[c.phone, c.email].filter(Boolean).join(" · ") || "no contact info"}</p>
                  </td>
                  <td className="px-4 py-2 text-stone-600">{c.lastVisit ? dateShort(c.lastVisit, business.timezone) : <span className="text-stone-400">—</span>}</td>
                  <td className="px-4 py-2 text-right">{money(Number(c.spend), business.currency)}</td>
                  <td className="px-4 py-2 text-stone-600">{dateShort(c.createdAt, business.timezone)}</td>
                  <td className="px-4 py-2 text-right">{Number(c.visitCount)}{Number(c.noShows) ? <span className="ml-1 text-xs text-red-600" title="No-shows">({Number(c.noShows)} NS)</span> : null}</td>
                  <td className="px-2 py-2 text-right"><Link href={`/app/${slug}/clients/${c.id}`} aria-label="Open"><ChevronRight className="h-4 w-4 text-stone-300" /></Link></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {r.pages > 1 ? (
          <div className="flex items-center justify-between border-t border-stone-200 px-4 py-2 text-sm text-stone-600">
            <span>{(r.page - 1) * r.pageSize + 1}–{Math.min(r.total, r.page * r.pageSize)} of {r.total}</span>
            <div className="flex gap-1">
              <LinkButton href={link({ page: Math.max(1, r.page - 1) })} size="sm" className={cn(r.page === 1 && "pointer-events-none opacity-40")}><ChevronLeft className="h-4 w-4" /></LinkButton>
              <LinkButton href={link({ page: Math.min(r.pages, r.page + 1) })} size="sm" className={cn(r.page === r.pages && "pointer-events-none opacity-40")}><ChevronRight className="h-4 w-4" /></LinkButton>
            </div>
          </div>
        ) : null}
      </Card>
    </>
  );
}
