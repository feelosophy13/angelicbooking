import type { Metadata } from "next";
import Link from "next/link";
import { Shell, date } from "@/components";
import { SORTS, STATUS_FILTERS, applyQuery, matchesStatus, parseQuery, type SortKey, type StatusFilter } from "@/lib/filters";
import { money } from "@/lib/price-form";
import { listTenantsWithBills } from "@/lib/tenants";
import { Icon } from "@/ui/icons";
import { Avatar, Badge, BTN, Empty, INPUT, PageHeader, SELECT, StatusBadge, relativeDay } from "@/ui/kit";

export const metadata: Metadata = { title: "Businesses" };
export const dynamic = "force-dynamic";

const PAGE = 25;

export default async function TenantsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const query = parseQuery(sp);
  const page = Math.max(1, Number(Array.isArray(sp.page) ? sp.page[0] : sp.page) || 1);
  const { tenants: all } = await listTenantsWithBills();
  const filtered = applyQuery(all, query);
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE));
  const rows = filtered.slice((Math.min(page, pages) - 1) * PAGE, Math.min(page, pages) * PAGE);
  const now = Date.now();
  const maxBookings = Math.max(1, ...all.map((t) => t.appointments30d));
  const counts = Object.fromEntries(STATUS_FILTERS.map(([k]) => [k, all.filter((t) => matchesStatus(t, k as StatusFilter, now)).length]));

  const href = (o: Partial<{ q: string; status: string; sort: string; dir: string; page: number }>) => {
    const n = { q: query.q, status: query.status, sort: query.sort, dir: query.dir, page: 1, ...o };
    const p = new URLSearchParams();
    if (n.q) p.set("q", n.q);
    if (n.status !== "all") p.set("status", n.status);
    if (n.sort !== "created") { p.set("sort", n.sort); p.set("dir", n.dir); }
    else if (n.dir !== "desc") p.set("dir", n.dir);
    if (n.page > 1) p.set("page", String(n.page));
    const s = p.toString();
    return `/tenants${s ? `?${s}` : ""}`;
  };
  const exportHref = `/export.csv?${new URLSearchParams({ q: query.q, status: query.status, sort: query.sort, dir: query.dir })}`;
  const th = (label: string, k: SortKey, right = false, extra = "") => (
    <th scope="col" className={`px-3 py-2.5 font-medium ${right ? "text-right" : ""} ${extra}`}>
      <Link href={href({ sort: k, dir: query.sort === k && query.dir === "desc" ? "asc" : "desc" })} className="hover:text-ink">{label}{query.sort === k ? (query.dir === "asc" ? " ↑" : " ↓") : ""}</Link>
    </th>
  );

  return (
    <Shell>
      <PageHeader
        title="Businesses"
        subtitle={`${all.length} businesses`}
        actions={<a href={exportHref} className={BTN}><Icon name="download" /> Export CSV</a>}
      />

      <form action="/tenants" className="flex flex-wrap items-center gap-2" role="search">
        <input name="q" defaultValue={query.q} placeholder="Search name, slug or owner email" className={`${INPUT} w-full sm:w-80`} />
        <input type="hidden" name="status" value={query.status} />
        <select name="sort" defaultValue={query.sort} className={`${SELECT} min-w-0 flex-1 sm:flex-none`} aria-label="Sort by">
          {SORTS.map(([k, label]) => <option key={k} value={k}>Sort: {label}</option>)}
        </select>
        <button className={BTN}>Search</button>
        {query.q && <Link href={href({ q: "" })} className="text-sm text-ink-3 underline">Clear search</Link>}
      </form>

      <div className="mt-3 flex flex-wrap gap-1.5" role="group" aria-label="Filter by status">
        {STATUS_FILTERS.map(([k, label]) => {
          const on = query.status === k;
          if (!on && k !== "all" && counts[k] === 0) return null;
          return (
            <Link key={k} href={href({ status: k, page: 1 })} aria-pressed={on} className={`rounded-full border px-3 py-1 text-sm ${on ? "border-brand bg-brand-soft font-medium text-brand" : "border-line bg-surface text-ink-2 hover:bg-surface-2"}`}>
              {label} <span className="tabular-nums text-ink-3">{counts[k]}</span>
            </Link>
          );
        })}
      </div>

      {rows.length === 0 ? (
        <div className="mt-4"><Empty title={all.length === 0 ? "No businesses yet" : "No businesses match"}>{all.length === 0 ? "They appear here as soon as someone signs up." : "Try a different search or filter."}</Empty></div>
      ) : (
        <div className="mt-4 overflow-x-auto rounded-xl border border-line bg-surface">
          <table className="w-full min-w-[600px] text-left text-sm">
            <thead className="border-b border-line bg-surface-2 text-xs uppercase tracking-wide text-ink-3">
              <tr>
                {th("Business", "name")}
                <th scope="col" className="px-3 py-2.5 font-medium">Status</th>
                {th("Locations", "locations", true)}
                {th("Staff", "staff", true)}
                {th("Clients", "clients", true, "hidden 2xl:table-cell")}
                <th scope="col" className="hidden px-3 py-2.5 font-medium xl:table-cell">Bookings (30d)</th>
                {th("Texts", "texts", true, "hidden 2xl:table-cell")}
                {th("Est. / month", "estimate", true)}
                {th("Last booking", "activity", false, "hidden 2xl:table-cell")}
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rows.map((t) => (
                <tr key={t.id} className="relative hover:bg-surface-2">
                  <td className="px-3 py-2.5">
                    <div className="flex items-center gap-3">
                      <Avatar name={t.name} size={34} />
                      <div className="min-w-0">
                        <Link href={`/tenants/${t.id}`} className="block truncate font-medium after:absolute after:inset-0">{t.name}</Link>
                        <div className="truncate text-xs text-ink-3">{t.ownerEmail ?? t.slug}</div>
                      </div>
                    </div>
                  </td>
                  <td className="px-3 py-2.5">
                    <div className="flex flex-wrap items-center gap-1">
                      {t.suspendedAt ? <Badge tone="warn">suspended</Badge> : <StatusBadge status={t.subscriptionStatus} plan={t.plan} />}
                      {t.comped && <Badge tone="info">comped</Badge>}
                      {!t.onboarded && !t.suspendedAt && <Badge tone="neutral" title="No services or staff yet">not set up</Badge>}
                    </div>
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{t.locations}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{t.activeStaff}</td>
                  <td className="hidden px-3 py-2.5 text-right tabular-nums 2xl:table-cell">{t.clients}</td>
                  <td className="hidden px-3 py-2.5 xl:table-cell">
                    <div className="flex items-center gap-2">
                      <span className="w-8 text-right tabular-nums">{t.appointments30d}</span>
                      <span className="h-1.5 w-20 overflow-hidden rounded-full bg-surface-2 ring-1 ring-line"><span className="block h-full rounded-full bg-brand" style={{ width: `${(t.appointments30d / maxBookings) * 100}%` }} /></span>
                    </div>
                  </td>
                  <td className="hidden px-3 py-2.5 text-right tabular-nums 2xl:table-cell">{t.sms30d}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">
                    {money(t.bill.totalCents)}
                    {t.hasOverrides && <span className="ml-1.5 align-middle"><Badge tone="brand" title="Custom pricing">custom</Badge></span>}
                  </td>
                  <td className="hidden px-3 py-2.5 text-ink-2 2xl:table-cell" title={date(t.lastAppointmentAt)}>{relativeDay(t.lastAppointmentAt, now)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {pages > 1 && (
        <nav className="mt-4 flex items-center justify-between text-sm" aria-label="Pages">
          <span className="text-ink-3">Page {Math.min(page, pages)} of {pages} · {filtered.length} businesses</span>
          <span className="flex gap-2">
            {page > 1 && <Link href={href({ page: page - 1 })} className={BTN}>Previous</Link>}
            {page < pages && <Link href={href({ page: page + 1 })} className={BTN}>Next</Link>}
          </span>
        </nav>
      )}
    </Shell>
  );
}
