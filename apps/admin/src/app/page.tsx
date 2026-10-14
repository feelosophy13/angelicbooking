import Link from "next/link";
import { Shell, StatusPill, date } from "@/components";
import { SORTS, STATUS_FILTERS, applyQuery, parseQuery, type SortKey } from "@/lib/filters";
import { money } from "@/lib/price-form";
import { listTenantsWithBills } from "@/lib/tenants";

export const dynamic = "force-dynamic";

export default async function TenantsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const query = parseQuery(await searchParams);
  const { tenants: all } = await listTenantsWithBills();
  const tenants = applyQuery(all, query);
  const paying = all.filter((t) => t.subscriptionStatus === "active").length;
  const trialing = all.filter((t) => t.subscriptionStatus === "trialing" || (t.plan === "trial" && t.subscriptionStatus === "none")).length;
  const attention = all.filter((t) => ["past_due", "unpaid"].includes(t.subscriptionStatus)).length;
  const estimated = all.reduce((s, t) => s + t.bill.totalCents, 0);
  const exportHref = `/export.csv?${new URLSearchParams({ q: query.q, status: query.status, sort: query.sort, dir: query.dir })}`;
  // Clicking a column heading sorts by it; clicking again flips the direction.
  const sortHref = (k: SortKey) => `/?${new URLSearchParams({ q: query.q, status: query.status, sort: k, dir: query.sort === k && query.dir === "desc" ? "asc" : "desc" })}`;
  const th = (label: string, k: SortKey, right = false) => (
    <th className={`px-3 py-2 ${right ? "text-right" : ""}`}>
      <Link href={sortHref(k)} className="hover:text-stone-900">{label}{query.sort === k ? (query.dir === "asc" ? " ↑" : " ↓") : ""}</Link>
    </th>
  );

  return (
    <Shell>
      <h1 className="text-xl font-semibold">Tenants</h1>
      <p className="mt-1 text-sm text-stone-600">
        {all.length} total · {paying} paying · {trialing} on trial{attention > 0 && <> · <span className="font-medium text-amber-700">{attention} need attention</span></>}
        {" · "}{money(estimated)}/mo if everyone paid the <Link href="/pricing" className="underline">price book</Link>
      </p>
      <form className="mt-4 flex flex-wrap items-center gap-2" role="search">
        <input name="q" defaultValue={query.q} placeholder="Search name, slug or owner email" className="w-72 rounded-md border border-stone-300 bg-white px-3 py-1.5 text-sm" />
        <select name="status" defaultValue={query.status} className="rounded-md border border-stone-300 bg-white px-2 py-1.5 text-sm">
          {STATUS_FILTERS.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
        </select>
        <select name="sort" defaultValue={query.sort} className="rounded-md border border-stone-300 bg-white px-2 py-1.5 text-sm">
          {SORTS.map(([k, label]) => <option key={k} value={k}>Sort: {label}</option>)}
        </select>
        <input type="hidden" name="dir" value={query.dir} />
        <button className="rounded-md bg-violet-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-violet-800">Apply</button>
        {(query.q || query.status !== "all") && <Link href="/" className="text-sm text-stone-600 underline">Clear</Link>}
        <a href={exportHref} className="ml-auto text-sm text-stone-600 underline">Export CSV ({tenants.length})</a>
      </form>
      <div className="mt-3 overflow-x-auto rounded-lg border border-stone-200 bg-white">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-stone-200 text-xs uppercase tracking-wide text-stone-500">
            <tr>
              {th("Business", "name")}
              <th className="px-3 py-2">Owner</th>
              <th className="px-3 py-2">Plan</th>
              {th("Locations", "locations", true)}
              {th("Staff", "staff", true)}
              {th("Clients", "clients", true)}
              {th("Texts 30d", "texts", true)}
              {th("Est. / month", "estimate", true)}
              {th("Last booking", "activity")}
              {th("Signed up", "created")}
            </tr>
          </thead>
          <tbody>
            {tenants.map((t) => (
              <tr key={t.id} className="border-b border-stone-100 last:border-0 hover:bg-stone-50">
                <td className="p-0">
                  <Link href={`/tenants/${t.id}`} className="block px-3 py-2">
                    <span className="font-medium">{t.name}</span>
                    {t.suspendedAt && <span className="ml-2 rounded bg-red-100 px-1 text-xs text-red-800">suspended</span>}
                    {t.comped && <span className="ml-2 rounded bg-sky-100 px-1 text-xs text-sky-800">comped</span>}
                    <span className="block text-xs text-stone-500">{t.slug}</span>
                  </Link>
                </td>
                <td className="px-3 py-2">{t.ownerEmail ?? "—"}</td>
                <td className="px-3 py-2"><span className="mr-2 capitalize">{t.plan}</span><StatusPill status={t.subscriptionStatus} /></td>
                <td className="px-3 py-2 text-right tabular-nums">{t.locations}</td>
                <td className="px-3 py-2 text-right tabular-nums">{t.activeStaff}</td>
                <td className="px-3 py-2 text-right tabular-nums">{t.clients}</td>
                <td className="px-3 py-2 text-right tabular-nums">{t.sms30d}</td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {money(t.bill.totalCents)}
                  {t.hasOverrides && <span title="Custom pricing" className="ml-1 rounded bg-violet-100 px-1 text-xs text-violet-800">custom</span>}
                </td>
                <td className="px-3 py-2">{date(t.lastAppointmentAt)}</td>
                <td className="px-3 py-2">{date(t.createdAt)}</td>
              </tr>
            ))}
            {tenants.length === 0 && (
              <tr><td colSpan={10} className="px-3 py-6 text-center text-stone-500">{all.length === 0 ? "No tenants yet." : "No tenants match."}</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </Shell>
  );
}
