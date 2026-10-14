import type { Metadata } from "next";
import { requireAction } from "@/lib/tenant";
import { listLocations, listSuppliers } from "@/server/inventory";
import { FormPage, Input, Select, Textarea } from "@/components/ui";
import { ActionForm, Field, SubmitButton } from "@/components/form";
import { newOrder } from "../../actions";

export const metadata: Metadata = { title: "New order · Inventory" };

export default async function NewOrderPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { business } = await requireAction(slug, "inventory.manage");
  const [suppliers, locations] = await Promise.all([listSuppliers(business.id), listLocations(business.id)]);
  return (
    <FormPage title="New order" backHref={`/app/${slug}/inventory/orders`} backLabel="Orders">
      <ActionForm action={newOrder}>
        <input type="hidden" name="slug" value={slug} />
        <Field label="Supplier" name="supplierId" hint={suppliers.length ? undefined : "Add suppliers under Inventory → Suppliers."}>
          <Select name="supplierId" defaultValue=""><option value="">No supplier yet</option>{suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select>
        </Field>
        {locations.length > 1 ? (
          <Field label="Deliver to" name="locationId"><Select name="locationId" defaultValue={locations.find((l) => l.isDefault)?.id}>{locations.map((l) => <option key={l.id} value={l.id}>{l.name.replace(`${business.name} - `, "")}</option>)}</Select></Field>
        ) : null}
        <Field label="Expected on" name="expectedOn"><Input type="date" name="expectedOn" /></Field>
        <Field label="Notes" name="notes"><Textarea name="notes" rows={3} /></Field>
        <SubmitButton pendingText="Creating…">Create order</SubmitButton>
      </ActionForm>
    </FormPage>
  );
}
