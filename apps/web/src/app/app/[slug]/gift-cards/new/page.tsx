import type { Metadata } from "next";
import { requireAction } from "@/lib/tenant";
import { FormPage, Input, MoneyInput } from "@/components/ui";
import { ActionForm, Field, SubmitButton } from "@/components/form";
import { ValidAt } from "@/components/offered-at";
import { listLocations } from "@/server/locations";
import { issueGiftCard } from "../../catalog-actions";

export const metadata: Metadata = { title: "Issue gift card" };

export default async function NewGiftCardPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { business } = await requireAction(slug, "checkout.take");
  const locations = await listLocations(business.id);
  return (
    <FormPage title="Issue gift card" backHref={`/app/${slug}/gift-cards`} backLabel="Gift cards" width="max-w-md">
      <p className="mb-3 text-sm text-stone-600">Use this for cards paid for outside a sale (or comped). To sell one, add it on the checkout screen instead so it appears on the receipt.</p>
      <ActionForm action={issueGiftCard}>
        <input type="hidden" name="slug" value={slug} />
        <Field label="Amount" name="amount" required><MoneyInput name="amount" required autoFocus /></Field>
        <Field label="Recipient (optional)" name="recipientName"><Input name="recipientName" placeholder="Name" /></Field>
        <ValidAt locations={locations} what="this gift card" />
        <SubmitButton pendingText="Issuing…">Issue gift card</SubmitButton>
      </ActionForm>
    </FormPage>
  );
}
