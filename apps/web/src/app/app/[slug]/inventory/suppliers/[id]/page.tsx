import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireAction } from "@/lib/tenant";
import { getSupplier } from "@/server/inventory";
import { FormPage } from "@/components/ui";
import { ActionForm, SubmitButton } from "@/components/form";
import { saveSupplier } from "../../actions";
import { SupplierFields } from "../supplier-fields";

export const metadata: Metadata = { title: "Supplier · Inventory" };

export default async function SupplierPage({ params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await params;
  const { business } = await requireAction(slug, "inventory.manage");
  const supplier = await getSupplier(business.id, id);
  if (!supplier) notFound();
  return (
    <FormPage title={supplier.name} backHref={`/app/${slug}/inventory/suppliers`} backLabel="Suppliers">
      <ActionForm action={saveSupplier}>
        <input type="hidden" name="slug" value={slug} />
        <input type="hidden" name="supplierId" value={supplier.id} />
        <SupplierFields supplier={supplier} />
        <SubmitButton pendingText="Saving…">Save supplier</SubmitButton>
      </ActionForm>
    </FormPage>
  );
}
