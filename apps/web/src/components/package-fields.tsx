import { ImageField } from "@/components/image-field";
import { Input, MoneyInput, Textarea } from "@/components/ui";
import { Field } from "@/components/form";
import { ServicePicker, type ServiceGroup } from "@/components/service-picker";
import { ValidAt } from "@/components/offered-at";

type Package = { name: string; serviceId: string | null; sessions: number; priceCents: number; validDays: number | null; description: string | null; imageUrl: string | null; validLocationIds: string[] };

/** The body of the new / edit package forms. */
export function PackageFields({ pkg, groups, locations, currency }: { pkg?: Package; groups: ServiceGroup[]; locations: { id: string; name: string }[]; currency: string }) {
  return (
    <>
      <Field label="Name" name="name" required><Input name="name" defaultValue={pkg?.name} required placeholder="5 Lash Fills" autoFocus /></Field>
      <Field label="Service" name="serviceId" hint="Choose one service, or let sessions be used on any service (e.g. a mixed facial bundle)."><ServicePicker name="serviceId" groups={groups} value={pkg?.serviceId ?? null} placeholder="Any service" noneLabel="Any service" /></Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Sessions" name="sessions" required><Input name="sessions" type="number" min={1} defaultValue={pkg?.sessions ?? 5} required /></Field>
        <Field label="Price" name="price" required><MoneyInput name="price" currency={currency} defaultValue={pkg ? (pkg.priceCents / 100).toFixed(2) : ""} required /></Field>
      </div>
      <Field label="Valid for (days)" name="validDays" hint="Leave blank if sessions never expire."><Input name="validDays" type="number" min={1} defaultValue={pkg?.validDays ?? ""} placeholder="365" /></Field>
      <Field label="Description" name="description"><Textarea name="description" rows={3} defaultValue={pkg?.description ?? ""} /></Field>
      <Field label="Photo" name="image" className="mt-2"><ImageField name="image" removeName={pkg ? "removeImage" : undefined} current={pkg?.imageUrl ?? null} /></Field>
      <ValidAt locations={locations} selected={pkg?.validLocationIds} what="package sessions" />
    </>
  );
}
