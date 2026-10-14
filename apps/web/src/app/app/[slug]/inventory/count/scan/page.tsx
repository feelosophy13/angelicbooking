import type { Metadata } from "next";
import { requireAction } from "@/lib/tenant";
import { bookByLocation, listLocations, scannableProducts, trackedProductIds } from "@/server/inventory";
import { BackLink } from "@/components/ui";
import { ScanSession } from "../../scan-session";

export const metadata: Metadata = { title: "Scan to count · Inventory" };

/** A count by scanning: each scan is one unit on the shelf, with how far it is from the book shown as you go. */
export default async function ScanCountPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { business } = await requireAction(slug, "inventory.manage");
  const [products, locations, book, tracked] = await Promise.all([scannableProducts(business.id), listLocations(business.id), bookByLocation(business.id), trackedProductIds(business.id)]);
  const short = (n: string) => n.replace(`${business.name} - `, "");
  return (
    <div className="space-y-3">
      <BackLink href={`/app/${slug}/inventory/count`}>Count</BackLink>
      <p className="text-sm text-stone-600">Scan every unit on the shelf at the location you pick. Products you scan are compared with the book and corrected; the rest are left alone unless you say anything not scanned is none.</p>
      <ScanSession slug={slug} mode="count" products={products} locations={locations.map((l) => ({ id: l.id, name: short(l.name) }))} defaultLocationId={locations.find((l) => l.isDefault)?.id ?? locations[0]!.id} book={book} trackedCount={tracked.length} />
    </div>
  );
}
