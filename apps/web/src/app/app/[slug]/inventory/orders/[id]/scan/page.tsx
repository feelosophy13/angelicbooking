import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireAction } from "@/lib/tenant";
import { getPurchaseOrder, scannableProducts } from "@/server/inventory";
import { listCategories } from "@/server/categories";
import { BackLink } from "@/components/ui";
import { ScanSession } from "../../../scan-session";

export const metadata: Metadata = { title: "Scan a delivery · Inventory" };

/** Check a delivery against its order by scanning: each line shows how many have come and how many are still to come. */
export default async function ScanOrderPage({ params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await params;
  const { business } = await requireAction(slug, "inventory.manage");
  const data = await getPurchaseOrder(business.id, id);
  if (!data) notFound();
  const { po, supplier, lines } = data;
  const open = po.status === "draft" || po.status === "ordered" || po.status === "partial";
  const [products, categories] = await Promise.all([scannableProducts(business.id), listCategories(business.id, "product")]);
  return (
    <div className="space-y-3">
      <BackLink href={`/app/${slug}/inventory/orders/${po.id}`}>Order #{po.number}</BackLink>
      <h2 className="text-lg font-semibold">Scan the delivery for order #{po.number}{supplier ? ` · ${supplier.name}` : ""}</h2>
      {open ? (
        <ScanSession slug={slug} mode="order" products={products} categories={categories.map((c) => ({ id: c.id, name: c.name }))} locations={[]} defaultLocationId="" order={{ id: po.id, number: po.number, supplier: supplier?.name ?? null, reference: po.reference ?? "", lines: lines.map((l) => ({ lineId: l.id, productId: l.productId, ordered: l.orderedQty, received: l.receivedQty })) }} />
      ) : (
        <p className="text-sm text-stone-600">This order is {po.status}, so there is nothing left to receive.</p>
      )}
    </div>
  );
}
