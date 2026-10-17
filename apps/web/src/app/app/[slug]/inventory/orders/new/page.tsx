import type { Metadata } from "next";
import Link from "next/link";
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
        {suppliers.length ? (
          <Field label="Supplier" name="supplierId">
            <Select name="supplierId" defaultValue=""><option value="">No supplier yet</option>{suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select>
          </Field>
        ) : (
          <p className="text-xs text-stone-500">No suppliers yet. Add them under <Link href={`/app/${slug}/inventory/suppliers`} className="underline">Inventory → Suppliers</Link> to put one on an order.</p>
        )}
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
