import { ImageField } from "@/components/image-field";
import { Input, MoneyInput, Textarea, Checkbox } from "@/components/ui";
import { Field } from "@/components/form";
import { CategoryPicker } from "@/components/categories";
import type { AnyCategory } from "@/server/categories";
import { ServiceTiming } from "@/components/service-timing";
import { OnlinePaymentField } from "@/components/online-payment-field";
import { OfferedAt } from "@/components/offered-at";
import { AiDescriptionField } from "@/components/ai-description-field";

type Service = { name: string; categoryId: string | null; description: string | null; prepNotes: string | null; imageUrl: string | null; durationMin: number; priceCents: number; gapMin: number; finishMin: number; bufferAfterMin: number; depositCents: number; depositType: string; depositPercent: number; capacity: number; bookableOnline: boolean };

/** The body of the new / edit service forms. */
export function ServiceFields({ service, categories, locations, offeredAt, defaultCategoryId, currency, stripeReady, paymentsHref, aiSlug }: { service?: Service; categories: AnyCategory[]; locations: { id: string; name: string }[]; offeredAt: string[]; defaultCategoryId?: string | null; currency: string; stripeReady: boolean; paymentsHref: string | null; /** Set when the AI assistant is on: the description box gets "Write with AI". */ aiSlug?: string }) {
  const $ = (c: number) => (c / 100).toFixed(2);
  return (
    <>
      <Field label="Name" name="name" required><Input name="name" defaultValue={service?.name ?? ""} required placeholder="Women's haircut" autoFocus /></Field>
      <Field label="Category" name="categoryIdNew"><CategoryPicker name="categoryId" categories={categories} value={service?.categoryId ?? defaultCategoryId ?? null} /></Field>
      <Field label="Description" name="description" hint="Shown on the booking page.">{aiSlug ? <AiDescriptionField slug={aiSlug} defaultValue={service?.description ?? ""} /> : <Textarea name="description" rows={4} defaultValue={service?.description ?? ""} />}</Field>
      <Field label="Photo" name="image" hint="Shown next to the service on the booking page."><ImageField name="image" removeName={service ? "removeImage" : undefined} current={service?.imageUrl ?? null} /></Field>
      <Field label="Before your visit" name="prepNotes" hint="Prep instructions sent with the confirmation and the reminder, e.g. “Arrive with clean, dry hair.” Leave empty to use the category's note."><Textarea name="prepNotes" rows={4} defaultValue={service?.prepNotes ?? ""} /></Field>
      <ServiceTiming duration={service?.durationMin ?? 45} gap={service?.gapMin ?? 0} finish={service?.finishMin ?? 0} buffer={service?.bufferAfterMin ?? 0} />
      <Field label="Price" name="price" required><MoneyInput name="price" currency={currency} defaultValue={service ? $(service.priceCents) : ""} required /></Field>
      <OnlinePaymentField type={service?.depositType ?? "flat"} depositCents={service?.depositCents ?? 0} percent={service?.depositPercent ?? 0} currency={currency} stripeReady={stripeReady} paymentsHref={paymentsHref} />
      <Field label="Group size" name="capacity" hint="1 = one client at a time. Higher numbers make this a class: you schedule sessions under Classes and several clients book the same one."><Input name="capacity" type="number" min={1} max={500} defaultValue={service?.capacity ?? 1} /></Field>
      <Checkbox name="bookableOnline" defaultChecked={service?.bookableOnline ?? true} label="Bookable online" />
      <OfferedAt locations={locations} selected={offeredAt} />
    </>
  );
}
