import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { can } from "@angelic/core";
import { requireAction } from "@/lib/tenant";
import { FormPage } from "@/components/ui";
import { getInvoice } from "@/server/invoices";
import { InvoiceFields } from "../../invoice-fields";
import { invoiceEditorData } from "../../editor-data";

export const metadata: Metadata = { title: "Edit invoice" };

export default async function EditInvoicePage({ params }: { params: Promise<{ slug: string; invoiceId: string }> }) {
  const { slug, invoiceId } = await params;
  const { business, permissions } = await requireAction(slug, "checkout.take");
  const inv = await getInvoice(business.id, invoiceId);
  if (!inv) notFound();
  // Only an unpaid, live invoice can change; anything else goes back to its page.
  if (inv.invoice.status === "void" || inv.sale.status !== "open") redirect(`/app/${slug}/sales/invoices/${invoiceId}`);
  const data = await invoiceEditorData(business);
  const dollars = (c: number) => (c / 100).toFixed(2);
  const editable = inv.lines.filter((l) => (l.kind === "service" || l.kind === "product") && l.creditCents === 0);
  const lines = editable.map((l, i) =>
    l.kind === "product" && l.productId
      ? { key: `e${i}`, kind: "product" as const, productId: l.productId, quantity: String(l.quantity), staffId: l.staffId ?? "" }
      : l.serviceId
        ? { key: `e${i}`, kind: "service" as const, serviceId: l.serviceId, staffId: l.staffId ?? "", price: dollars(l.unitCents) }
        : { key: `e${i}`, kind: "custom" as const, name: l.name, price: dollars(l.unitCents), quantity: String(l.quantity), taxable: l.taxable, staffId: l.staffId ?? "" },
  );
  const { invoice, sale, client } = inv;
  const discount = (sale.discountType === "amount" || sale.discountType === "percent") && sale.discountValue ? { type: sale.discountType as "amount" | "percent", value: sale.discountValue } : null;
  return (
    <FormPage title={`Edit invoice #${sale.number}`} backHref={`/app/${slug}/sales/invoices/${invoiceId}`} backLabel={`Invoice #${sale.number}`} width="max-w-3xl">
      <InvoiceFields
        {...data}
        slug={slug}
        canCreateClient={can(permissions, "clients.write")}
        defaultDueOn=""
        initial={{
          invoiceId,
          client: client ? { id: client.id, name: `${client.firstName} ${client.lastName ?? ""}`.trim() } : { id: "", name: "" },
          locationId: sale.locationId,
          lines,
          discount,
          taxExempt: sale.taxExempt,
          dueOn: invoice.dueOn,
          note: invoice.note,
          deposit: invoice.depositType ? { type: invoice.depositType, value: invoice.depositValue ?? 0 } : null,
          remind: invoice.remind,
          otherLines: inv.lines.filter((l) => !editable.includes(l)).map((l) => ({ name: l.name, amountCents: l.amountCents })),
        }}
      />
    </FormPage>
  );
}
