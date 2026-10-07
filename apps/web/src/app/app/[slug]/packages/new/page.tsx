import { requireAction } from "@/lib/tenant";
import { getOffersCatalog } from "@/server/offers";
import { Button, Field, FormPage, Input, Select } from "@/components/ui";
import { createPackage } from "../../catalog-actions";

export default async function NewPackagePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { business } = await requireAction(slug, "services.manage");
  const { services } = await getOffersCatalog(business.id);
  return (
    <FormPage title="New package" backHref={`/app/${slug}/packages`} backLabel="Packages" width="max-w-lg">
      <form action={createPackage} className="space-y-3">
        <input type="hidden" name="slug" value={slug} />
        <Field label="Name"><Input name="name" required placeholder="5 Lash Fills" autoFocus /></Field>
        <Field label="Service"><Select name="serviceId" required>{services.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Sessions"><Input name="sessions" type="number" min={1} defaultValue={5} required /></Field>
          <Field label="Price"><Input name="price" inputMode="decimal" required placeholder="275" /></Field>
        </div>
        <Field label="Valid for (days)" hint="Leave blank if sessions never expire."><Input name="validDays" type="number" min={1} placeholder="365" /></Field>
        <Button type="submit">Create package</Button>
      </form>
    </FormPage>
  );
}
