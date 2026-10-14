import type { Metadata } from "next";
import Link from "next/link";
import { requireAction } from "@/lib/tenant";
import { FormPage } from "@/components/ui";
import { PRODUCT_CSV_HEADERS } from "@/lib/inventory";
import { ImportForm } from "./import-form";

export const metadata: Metadata = { title: "Import products" };

export default async function ImportProductsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  await requireAction(slug, "services.manage");
  return (
    <FormPage title="Import products" backHref={`/app/${slug}/products`} backLabel="Products">
      <div className="mb-4 space-y-2 text-sm text-stone-600">
        <p>Add or update many products from a spreadsheet. The easiest start is <Link className="text-brand-700 underline" href={`/app/${slug}/products/export`}>exporting what you have</Link>, changing it, and importing it back.</p>
        <p>The first row holds the column names. Only <strong>Name</strong> is required; a blank cell leaves that product's value as it is. A row matches an existing product by barcode, then SKU, then name and option. <strong>On hand</strong> sets the count at your main location and is kept in the stock history.</p>
        <p className="text-xs text-stone-500">Columns understood: {PRODUCT_CSV_HEADERS.join(", ")}. Common alternatives (UPC, Vendor, Qty, Retail Price…) work too.</p>
      </div>
      <ImportForm slug={slug} />
    </FormPage>
  );
}
