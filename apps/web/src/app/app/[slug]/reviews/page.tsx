import Link from "next/link";
import type { Metadata } from "next";
import { asc, eq } from "drizzle-orm";
import { schema, withTenant } from "@angelic/db";
import { can, instantToISODate, zonedToInstant } from "@angelic/core";
import { requireAnyAction } from "@/lib/tenant";
import { canSeeClientContact, canSeeReviews } from "@/lib/visibility";
import { listReviews } from "@/server/reviews";
import { listLocations } from "@/server/locations";
import { shiftISODate } from "@/lib/utils";
import { Card, Input, PageHeader, Empty, Select } from "@/components/ui";
import { LocationFilter } from "@/components/location-filter";
import { AutoSubmitForm } from "@/components/auto-submit-form";

export const metadata: Metadata = { title: "Reviews" };

function Stars({ n }: { n: number | null }) {
  return <span className="text-amber-400" aria-label={`${n ?? 0} stars`}>{"★".repeat(n ?? 0)}<span className="text-stone-300">{"★".repeat(5 - (n ?? 0))}</span></span>;
}

type SP = { location?: string; staff?: string; from?: string; to?: string; rating?: string };
const isDate = (v?: string) => !!v && /^\d{4}-\d{2}-\d{2}$/.test(v);

export default async function ReviewsPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<SP> }) {
  const { slug } = await params;
  const sp = await searchParams;
  // Every review, or only the reviews of visits they performed (R1). The author's name needs the client-contact permission.
  const { business, permissions, staffId: myStaffId } = await requireAnyAction(slug, "reviews.view", "reviews.view.own");
  const scope = canSeeReviews(permissions)!;
  const ownOnly = scope === "own";
  const showAuthor = canSeeClientContact(permissions);
  const linkClient = can(permissions, "clients.read");
  const [locations, providers] = await Promise.all([
    listLocations(business.id),
    withTenant(business.id, (tx) => tx.select({ id: schema.staff.id, name: schema.staff.displayName }).from(schema.staff).where(eq(schema.staff.takesAppointments, true)).orderBy(asc(schema.staff.displayName))),
  ]);
  const locationId = locations.some((l) => l.id === sp.location) ? sp.location! : null;
  // An own-only viewer is pinned to their own lines; a login not linked to a staff member has none.
  const staffId = ownOnly ? (myStaffId ?? "none") : providers.some((p) => p.id === sp.staff) ? sp.staff! : null;
  const from = isDate(sp.from) ? sp.from! : null;
  const to = isDate(sp.to) ? sp.to! : null;
  const rating = /^[1-5]$/.test(sp.rating ?? "") ? Number(sp.rating) : null;
  const r = await listReviews(business.id, {
    locationId,
    staffId,
    rating,
    from: from ? zonedToInstant(from, "00:00", business.timezone) : null,
    to: to ? zonedToInstant(shiftISODate(to, 1), "00:00", business.timezone) : null,
  });
  const fmt = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeZone: business.timezone });
  const today = instantToISODate(new Date(), business.timezone);
  const filtered = !!(locationId || staffId || from || to || rating);
  // Keep the other filters when switching location pills.
  const otherQuery = [staffId ? `staff=${staffId}` : "", from ? `from=${from}` : "", to ? `to=${to}` : "", rating ? `rating=${rating}` : ""].filter(Boolean).join("&");
  const withRating = (star: number | null) => `?${[locationId ? `location=${locationId}` : "", staffId ? `staff=${staffId}` : "", from ? `from=${from}` : "", to ? `to=${to}` : "", star ? `rating=${star}` : ""].filter(Boolean).join("&")}`;
  const quick = (label: string, f: string, t: string) => <Link href={`?${[locationId ? `location=${locationId}` : "", staffId ? `staff=${staffId}` : "", `from=${f}`, `to=${t}`, rating ? `rating=${rating}` : ""].filter(Boolean).join("&")}`} className="rounded-md px-2 py-1 text-xs text-stone-600 hover:bg-stone-100">{label}</Link>;
  const pct = (n: number) => (r.count ? Math.round((n / r.count) * 100) : 0);
  return (
    <>
      <PageHeader title="Reviews">
        {can(permissions, "reports.view") && (from || to) ? <Link href={`/app/${slug}/reports?from=${from ?? to}&to=${to ?? from}${locationId ? `&location=${locationId}` : ""}`} className="text-sm text-brand-700 underline">Sales for these dates</Link> : null}
        {can(permissions, "settings.business") ? <Link href={`/app/${slug}/settings/reviews`} className="text-sm text-brand-700 underline">Settings</Link> : null}
      </PageHeader>
      <Card className="mb-4 p-3">
        <AutoSubmitForm className="flex flex-wrap items-end gap-3">
          {locationId ? <input type="hidden" name="location" value={locationId} /> : null}
          <LocationFilter locations={locations} current={locationId} query={otherQuery} />
          {providers.length > 1 && !ownOnly ? (
            <label className="text-sm">
              <span className="mb-1 block text-xs font-medium text-stone-500">Provider</span>
              <Select name="staff" defaultValue={staffId ?? ""} className="h-9 w-44">
                <option value="">All providers</option>
                {providers.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </Select>
            </label>
          ) : null}
          <label className="text-sm">
            <span className="mb-1 block text-xs font-medium text-stone-500">Stars</span>
            <Select name="rating" defaultValue={rating ?? ""} className="h-9 w-28">
              <option value="">Any</option>
              {[5, 4, 3, 2, 1].map((n) => <option key={n} value={n}>{"★".repeat(n)}</option>)}
            </Select>
          </label>
          <label className="text-sm"><span className="mb-1 block text-xs font-medium text-stone-500">From</span><Input type="date" name="from" defaultValue={from ?? ""} max={today} className="h-9 w-40" /></label>
          <label className="text-sm"><span className="mb-1 block text-xs font-medium text-stone-500">To</span><Input type="date" name="to" defaultValue={to ?? ""} max={today} className="h-9 w-40" /></label>
          <div className="flex items-center gap-1">
            {quick("Last 30 days", shiftISODate(today, -29), today)}
            {quick("Last 90 days", shiftISODate(today, -89), today)}
            {quick("This year", `${today.slice(0, 4)}-01-01`, today)}
          </div>
          {filtered ? <Link href="?" className="text-xs text-stone-500 underline">Clear filters</Link> : null}
        </AutoSubmitForm>
      </Card>
      {ownOnly ? <p className="mb-3 text-sm text-stone-600">Your reviews: what clients said after the visits you performed.</p> : null}
      <div className={`mb-6 grid gap-3 sm:grid-cols-2 ${ownOnly ? "lg:grid-cols-3" : "lg:grid-cols-4"}`}>
        <Card className="p-4"><p className="text-xs uppercase tracking-wide text-stone-500">Average</p><p className="text-xl font-semibold">{r.count ? r.average.toFixed(1) : "—"} <span className="text-sm font-normal text-stone-500">/ 5</span></p></Card>
        <Card className="p-4"><p className="text-xs uppercase tracking-wide text-stone-500">Ratings</p><p className="text-xl font-semibold">{r.count}</p><p className="text-xs text-stone-500">of {r.requested} requested{r.requested ? ` · ${Math.round((r.count / r.requested) * 100)}% answered` : ""}</p></Card>
        <Card className="p-4">
          <p className="mb-1 text-xs uppercase tracking-wide text-stone-500">Breakdown</p>
          {r.distribution.map((d) => (
            <Link key={d.star} href={withRating(rating === d.star ? null : d.star)} className={`flex items-center gap-2 rounded px-1 text-xs hover:bg-stone-50 ${rating === d.star ? "bg-amber-50" : ""}`} title={rating === d.star ? "Show all ratings" : `Show only ${d.star}-star ratings`}>
              <span className="w-6 text-stone-500">{d.star}★</span>
              <span className="h-1.5 flex-1 overflow-hidden rounded bg-stone-100"><span className="block h-full bg-amber-400" style={{ width: `${pct(d.n)}%` }} /></span>
              <span className="w-8 text-right text-stone-500">{d.n}</span>
            </Link>
          ))}
        </Card>
        {ownOnly ? null : <Card className="p-4">
          <p className="text-xs uppercase tracking-wide text-stone-500">By provider</p>
          {r.byStaff.length === 0 ? <p className="text-sm text-stone-500">—</p> : r.byStaff.map((s) => (
            <p key={s.staffId} className="text-sm">
              <Link href={`?${[locationId ? `location=${locationId}` : "", `staff=${s.staffId}`, from ? `from=${from}` : "", to ? `to=${to}` : ""].filter(Boolean).join("&")}`} className="hover:underline">{s.staffName}</Link>: <b>{s.avg.toFixed(1)}</b> <span className="text-stone-500">({s.n})</span>
            </p>
          ))}
        </Card>}
      </div>
      {r.rows.length === 0 ? (
        <Empty title={filtered ? (rating ? `No ${rating}-star ratings match these filters` : "No ratings match these filters") : "No ratings yet"} body={filtered ? "Try a wider date range or clear the filters." : "Clients are asked to rate each visit a couple of hours after checkout."} />
      ) : (
        <Card>
          <ul className="divide-y divide-stone-100 text-sm">
            {r.rows.map(({ r: rv, firstName, lastName, staffName, locationName }) => (
              <li key={rv.id} className="px-4 py-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span><Stars n={rv.rating} /> <span className="ml-2 font-medium">{showAuthor && firstName ? `${firstName} ${lastName ?? ""}`.trim() : "Client"}</span>{staffName && !ownOnly ? <span className="text-stone-500"> · with {staffName}</span> : null}{locations.length > 1 && locationName ? <span className="text-stone-500"> · {locationName.replace(/^.*? - /, "")}</span> : null}</span>
                  <span className="text-xs text-stone-500">{rv.submittedAt ? fmt.format(rv.submittedAt) : ""}{rv.clientId && linkClient ? <> · <Link href={`/app/${slug}/clients/${rv.clientId}`} className="underline">client</Link></> : null}</span>
                </div>
                {rv.comment ? <p className="mt-1 whitespace-pre-line text-stone-700">{rv.comment}</p> : null}
              </li>
            ))}
          </ul>
          {r.rows.length >= 200 ? <p className="px-4 py-2 text-xs text-stone-500">Showing the latest 200. Narrow the date range to see older ratings.</p> : null}
        </Card>
      )}
    </>
  );
}
