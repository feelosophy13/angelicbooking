import type { Metadata } from "next";
import { ChevronRight } from "lucide-react";
import { can } from "@angelic/core";
import { requireAnyAction } from "@/lib/tenant";
import { Card, Empty, LinkButton, PageHeader } from "@/components/ui";
import { Disclosure } from "@/components/disclosure";
import { LocationFilter } from "@/components/location-filter";
import { rowClass, RowLink } from "@/components/row";
import { listLocations } from "@/server/locations";
import { getDrawer, lastClose, openDrawers } from "@/server/drawer";
import { formatMoney, formatTime } from "@/lib/utils";
import { siteLabels } from "@/lib/location-ui";
import { OpenDrawerForm } from "./forms";
import { DrawerPanel } from "./panel";
import { pickLocation, tipStaff } from "./data";

export const metadata: Metadata = { title: "Cash drawer" };

export default async function DrawerPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ location?: string }> }) {
  const { slug } = await params;
  const sp = await searchParams;
  const { business, permissions } = await requireAnyAction(slug, "drawer.manage", "reports.view");
  const canManage = can(permissions, "drawer.manage");
  const canReports = can(permissions, "reports.view");
  const locations = await listLocations(business.id);
  const loc = pickLocation(locations, sp.location);
  const base = `/app/${slug}`;
  const currency = business.currency;
  const tz = business.timezone;
  const site = loc ? (locations.length > 1 ? ` · ${siteLabels(locations).get(loc.id)}` : "") : "";
  const open = loc ? await openDrawers(business.id, loc.id) : [];
  const [only, staff, last] = await Promise.all([open.length === 1 ? getDrawer(business.id, open[0]!.id) : null, canManage ? tipStaff(business.id) : [], loc && canManage && !open.length ? lastClose(business.id, loc.id) : null]);
  const lq = loc && locations.length > 1 ? `?location=${loc.id}` : "";

  return (
    <div>
      <PageHeader title={`Cash drawer${only && only.register !== "Main" ? ` · ${only.register}` : ""}`}>
        {canReports ? <LinkButton href={`${base}/drawer/history${lq}`} size="sm">History</LinkButton> : null}
        {canReports ? <LinkButton href={`${base}/reports/closing${lq}`} size="sm">Closing report</LinkButton> : null}
      </PageHeader>
      {locations.length > 1 ? (
        <div className="mb-4">
          <LocationFilter locations={locations} current={loc?.id ?? null} query="" allLabel={null} />
        </div>
      ) : null}
      {!loc ? (
        <Empty title="Add a location first" body="A drawer belongs to a location." action={{ href: `${base}/settings/locations`, label: "Locations" }} />
      ) : !open.length ? (
        canManage ? (
          <Card className="max-w-2xl p-4">
            <h2 className="font-semibold text-stone-800">Open the drawer{site}</h2>
            <p className="mb-4 text-sm text-stone-500">Count the float before the first sale. Cash taken at checkout goes into the open drawer.</p>
            <OpenDrawerForm slug={slug} locationId={loc.id} currency={currency} suggestedFloatCents={last?.countedCents ?? null} showRegister={false} />
          </Card>
        ) : (
          <Empty title="No drawer is open" body="The front desk opens the drawer with a float at the start of the day." />
        )
      ) : only ? (
        <DrawerPanel d={only} slug={slug} currency={currency} tz={tz} canManage={canManage} staff={staff} />
      ) : (
        <Card>
          <ul className="divide-y divide-stone-100">
            {open.map((d) => (
              <li key={d.id} className={`${rowClass} flex items-center gap-3 px-4 py-3`}>
                <div className="min-w-0 flex-1">
                  <RowLink href={`${base}/drawer/${d.id}`} className="font-medium text-stone-900">{d.register}</RowLink>
                  <p className="text-xs text-stone-500">Opened {formatTime(d.openedAt, tz)}{d.openedByName ? ` by ${d.openedByName}` : ""}</p>
                </div>
                <div className="w-28 shrink-0 text-right tabular-nums">{formatMoney(d.expectedCents, currency)}</div>
                <ChevronRight className="h-4 w-4 text-stone-300" aria-hidden />
              </li>
            ))}
          </ul>
        </Card>
      )}
      {loc && open.length && canManage ? (
        <Disclosure title="Open another register" hint="For a site with more than one drawer" className="mt-6 max-w-2xl print:hidden">
          <OpenDrawerForm slug={slug} locationId={loc.id} currency={currency} suggestedFloatCents={null} showRegister />
        </Disclosure>
      ) : null}
      {open.length > 1 ? <p className="mt-3 text-xs text-stone-500">Cash goes into the drawer the person taking it opened, else the one open longest.</p> : null}
    </div>
  );
}
