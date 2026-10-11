import { ImageField } from "@/components/image-field";
import { Input, MoneyInput, Textarea, Checkbox } from "@/components/ui";
import { Field } from "@/components/form";
import { CategoryPicker } from "@/components/categories";
import type { AnyCategory } from "@/server/categories";
import { OfferedAt } from "@/components/offered-at";

type Service = { name: string; categoryId: string | null; description: string | null; prepNotes: string | null; imageUrl: string | null; durationMin: number; priceCents: number; gapMin: number; finishMin: number; bufferAfterMin: number; depositCents: number; capacity: number; bookableOnline: boolean };

/** The body of the new / edit service forms. */
export function ServiceFields({ service, categories, locations, offeredAt, defaultCategoryId, currency }: { service?: Service; categories: AnyCategory[]; locations: { id: string; name: string }[]; offeredAt: string[]; defaultCategoryId?: string | null; currency: string }) {
  const $ = (c: number) => (c / 100).toFixed(2);
  return (
    <>
      <Field label="Name" name="name" required><Input name="name" defaultValue={service?.name ?? ""} required placeholder="Women's haircut" autoFocus /></Field>
      <Field label="Category" name="categoryIdNew"><CategoryPicker name="categoryId" categories={categories} value={service?.categoryId ?? defaultCategoryId ?? null} /></Field>
      <Field label="Description" name="description" hint="Shown on the booking page."><Textarea name="description" rows={4} defaultValue={service?.description ?? ""} /></Field>
      <Field label="Photo" name="image" hint="Shown next to the service on the booking page."><ImageField name="image" removeName={service ? "removeImage" : undefined} current={service?.imageUrl ?? null} /></Field>
      <Field label="Before your visit" name="prepNotes" hint="Prep instructions sent with the confirmation and the reminder, e.g. “Arrive with clean, dry hair.” Leave empty to use the category's note."><Textarea name="prepNotes" rows={4} defaultValue={service?.prepNotes ?? ""} /></Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Duration (min)" name="durationMin" required><Input name="durationMin" type="number" min={5} step={5} defaultValue={service?.durationMin ?? 45} required /></Field>
        <Field label="Price" name="price" required><MoneyInput name="price" currency={currency} defaultValue={service ? $(service.priceCents) : ""} required /></Field>
      </div>
      <div className="grid grid-cols-3 gap-3">
        <Field label="Processing (min)" name="gapMin" hint="Free gap, e.g. colour developing"><Input name="gapMin" type="number" min={0} step={5} defaultValue={service?.gapMin ?? 0} /></Field>
        <Field label="Finish (min)" name="finishMin" hint="Second block after the gap"><Input name="finishMin" type="number" min={0} step={5} defaultValue={service?.finishMin ?? 0} /></Field>
        <Field label="Buffer (min)" name="bufferAfterMin" hint="Clean-up after"><Input name="bufferAfterMin" type="number" min={0} step={5} defaultValue={service?.bufferAfterMin ?? 0} /></Field>
      </div>
      <Field label="Deposit" name="deposit" hint="Charged when booking online (Stripe must be connected); comes off the bill at checkout and is refunded on cancellations inside the policy window."><MoneyInput name="deposit" currency={currency} defaultValue={service?.depositCents ? $(service.depositCents) : ""} /></Field>
      <Field label="Group size" name="capacity" hint="1 = one client at a time. Higher numbers make this a class: you schedule sessions under Classes and several clients book the same one."><Input name="capacity" type="number" min={1} max={500} defaultValue={service?.capacity ?? 1} /></Field>
      <Checkbox name="bookableOnline" defaultChecked={service?.bookableOnline ?? true} label="Bookable online" />
      <OfferedAt locations={locations} selected={offeredAt} />
    </>
  );
}
