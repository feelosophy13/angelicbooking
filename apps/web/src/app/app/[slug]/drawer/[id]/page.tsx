import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { can, instantToISODate } from "@angelic/core";
import { requireAnyAction } from "@/lib/tenant";
import { BackLink, PageHeader } from "@/components/ui";
import { getDrawer } from "@/server/drawer";
import { formatDateLong } from "@/lib/utils";
import { siteLabels } from "@/lib/location-ui";
import { listLocations } from "@/server/locations";
import { DrawerPanel } from "../panel";
import { tipStaff } from "../data";
import { CorrectDrawerForm } from "../forms";

export const metadata: Metadata = { title: "Cash drawer" };

export default async function DrawerSessionPage({ params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await params;
  const { business, permissions } = await requireAnyAction(slug, "drawer.manage", "reports.view");
  const d = await getDrawer(business.id, id);
  if (!d) notFound();
  const canManage = can(permissions, "drawer.manage");
  // Tip payouts are recorded while the drawer is open, or added afterwards by someone correcting the close-out.
  const canCorrect = d.status === "closed" && can(permissions, "reports.view");
  const staff = (canManage && d.status === "open") || canCorrect ? await tipStaff(business.id) : [];
  const site = siteLabels(await listLocations(business.id)).get(d.locationId) ?? d.locationName;
  const day = formatDateLong(instantToISODate(d.openedAt, business.timezone));
  return (
    <div>
      <BackLink href={`/app/${slug}/drawer${d.status === "closed" && can(permissions, "reports.view") ? "/history" : ""}`}>{d.status === "closed" && can(permissions, "reports.view") ? "Close-out history" : "Cash drawer"}</BackLink>
      <PageHeader title={`${d.register === "Main" ? "Drawer" : d.register} · ${day}`} />
      <p className="-mt-3 mb-4 text-sm text-stone-500">{site}{d.status === "open" ? " · open" : " · closed"}</p>
      <DrawerPanel d={d} slug={slug} currency={business.currency} tz={business.timezone} canManage={canManage} staff={staff} />
      {canCorrect ? <div className="mt-6 max-w-2xl"><CorrectDrawerForm slug={slug} sessionId={d.id} currency={business.currency} countedCents={d.countedCents} staff={staff} /></div> : null}
    </div>
  );
}
