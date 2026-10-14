import type { Metadata } from "next";
import { requireAction } from "@/lib/tenant";
import { FormPage } from "@/components/ui";
import { ActionForm, SubmitButton } from "@/components/form";
import { saveSupplier } from "../../actions";
import { SupplierFields } from "../supplier-fields";

export const metadata: Metadata = { title: "New supplier · Inventory" };

export default async function NewSupplierPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  await requireAction(slug, "inventory.manage");
  return (
    <FormPage title="New supplier" backHref={`/app/${slug}/inventory/suppliers`} backLabel="Suppliers">
      <ActionForm action={saveSupplier}>
        <input type="hidden" name="slug" value={slug} />
        <SupplierFields />
        <SubmitButton pendingText="Saving…">Add supplier</SubmitButton>
      </ActionForm>
    </FormPage>
  );
}
