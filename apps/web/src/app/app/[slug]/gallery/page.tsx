import type { Metadata } from "next";
import Link from "next/link";
import { asc, eq } from "drizzle-orm";
import { schema, withTenant } from "@angelic/db";
import { requireAction } from "@/lib/tenant";
import { listLocations } from "@/server/locations";
import { listGallery, photoTagsInUse } from "@/server/visit-photos";
import { serviceGroups } from "@/server/service-groups";
import { listCategories } from "@/server/categories";
import { ServicePicker } from "@/components/service-picker";
import { GALLERY_PERIODS, hasGalleryFilters, parseGalleryFilters, type GallerySearchParams } from "@/lib/visit-photos";
import { pairViews } from "@/lib/gallery-view";
import { PairCard } from "@/components/photo-pair";
import { LocationFilter } from "@/components/location-filter";
import { Button, Card, Checkbox, Empty, Input, PageHeader, Select } from "@/components/ui";

export const metadata: Metadata = { title: "Gallery" };

/** Every before and after photo, newest first. Filter by service, stylist, tag, client, place and time. */
export default async function GalleryPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<GallerySearchParams> }) {
  const { slug } = await params;
  const sp = await searchParams;
  const { business } = await requireAction(slug, "clients.photos");
  const [locations, services, staff, tags, categories] = await Promise.all([
    listLocations(business.id),
    withTenant(business.id, (tx) => tx.select({ id: schema.services.id, name: schema.services.name }).from(schema.services).orderBy(asc(schema.services.name))),
    withTenant(business.id, (tx) => tx.select({ id: schema.staff.id, name: schema.staff.displayName }).from(schema.staff).orderBy(asc(schema.staff.sortOrder), asc(schema.staff.displayName))),
    photoTagsInUse(business.id),
    listCategories(business.id, "service"),
  ]);
  // Every category and service, grouped and searchable: a filter that hides what has no photos yet cannot be chosen before the first photo.
  const groups = await serviceGroups(business, { meta: "none", categories: true });
  const f = parseGalleryFilters(sp, { serviceIds: services.map((s) => s.id), categoryIds: categories.map((c) => c.id), staffIds: staff.map((s) => s.id), locationIds: locations.map((l) => l.id) });
  const { pairs, hasMore } = await listGallery(business.id, f);
  const views = pairViews(slug, pairs, business.timezone);
  const filtered = hasGalleryFilters(f);
  const clientName = f.clientId ? (pairs[0]?.clientName ?? null) : null;

  const qs = (over: Record<string, string | null | undefined> = {}) => {
    const all: Record<string, string | null | undefined> = { service: f.categoryId ? `c:${f.categoryId}` : f.serviceId, staff: f.staffId, client: f.clientId, location: f.locationId, tag: f.tag, period: f.periodDays ? String(f.periodDays) : null, q: f.q, both: f.bothOnly ? "1" : null, share: f.shareableOnly ? "1" : null, ...over };
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(all)) if (v) p.set(k, v);
    return p.toString();
  };

  return (
    <>
      <PageHeader title="Gallery" />
      <Card className="mb-4 p-3">
        <div className="flex flex-wrap items-center gap-2">
          <LocationFilter locations={locations} current={f.locationId} query={qs({ location: null, page: null })} allLabel="All" />
          <form method="get" className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
            {f.locationId ? <input type="hidden" name="location" value={f.locationId} /> : null}
            {f.clientId ? <input type="hidden" name="client" value={f.clientId} /> : null}
            <ServicePicker name="service" groups={groups} value={f.categoryId ? `c:${f.categoryId}` : f.serviceId} noneLabel="Any service" compact />
            {staff.length > 1 ? (
              <Select name="staff" defaultValue={f.staffId ?? ""} aria-label="Stylist" className="h-9 w-auto">
                <option value="">Any stylist</option>
                {staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </Select>
            ) : null}
            {tags.length ? (
              <Select name="tag" defaultValue={f.tag ?? ""} aria-label="Tag" className="h-9 w-auto">
                <option value="">Any tag</option>
                {tags.map((t) => <option key={t} value={t}>#{t}</option>)}
              </Select>
            ) : null}
            <Select name="period" defaultValue={f.periodDays ? String(f.periodDays) : ""} aria-label="When" className="h-9 w-auto">
              {GALLERY_PERIODS.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
            </Select>
            <Input name="q" defaultValue={f.q ?? ""} placeholder="Client name" className="h-9 min-w-0 flex-1 basis-36" aria-label="Client name" />
            <Checkbox name="both" value="1" defaultChecked={f.bothOnly} label="Before and after" className="items-center" />
            <Checkbox name="share" value="1" defaultChecked={f.shareableOnly} label="OK to share" className="items-center" />
            <Button type="submit" size="sm" variant="secondary">Apply</Button>
            {filtered ? <Link href={f.clientId ? `?client=${f.clientId}` : "?"} className="text-sm text-stone-600 underline">Clear</Link> : null}
          </form>
        </div>
        {f.clientId ? (
          <p className="mt-2 text-sm text-stone-600">Showing photos of {clientName ?? "one client"}. <Link href={`?${qs({ client: null, page: null })}`} className="underline">Show everyone</Link></p>
        ) : null}
      </Card>

      {views.length === 0 ? (
        <Empty title={filtered ? "No photos match" : "No photos yet"} body={filtered ? "Try clearing a filter." : "Open an appointment and add before and after photos. They appear here, ready to filter by service, stylist and tag."} />
      ) : (
        <>
          <ul className="grid grid-cols-1 gap-3 min-[420px]:grid-cols-2 md:grid-cols-3 xl:grid-cols-4">
            {views.map((v) => <li key={v.key}><PairCard pair={v} /></li>)}
          </ul>
          {f.page > 1 || hasMore ? (
            <div className="mt-4 flex items-center justify-between text-sm text-stone-600">
              <span>Page {f.page}</span>
              <span className="flex gap-3">
                {f.page > 1 ? <Link href={`?${qs({ page: String(f.page - 1) })}`} className="underline">Previous</Link> : null}
                {hasMore ? <Link href={`?${qs({ page: String(f.page + 1) })}`} className="underline">Next</Link> : null}
              </span>
            </div>
          ) : null}
        </>
      )}
    </>
  );
}
