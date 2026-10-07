import { requireAction } from "@/lib/tenant";
import { Button, Field, FormPage, Input } from "@/components/ui";
import { issueGiftCard } from "../../catalog-actions";

export default async function NewGiftCardPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  await requireAction(slug, "checkout.take");
  return (
    <FormPage title="Issue gift card" backHref={`/app/${slug}/gift-cards`} backLabel="Gift cards" width="max-w-md">
      <p className="mb-3 text-sm text-stone-600">Use this for cards paid for outside a sale (or comped). To sell one, add it on the checkout screen instead so it appears on the receipt.</p>
      <form action={issueGiftCard} className="space-y-3">
        <input type="hidden" name="slug" value={slug} />
        <Field label="Amount"><Input name="amount" inputMode="decimal" required placeholder="50" autoFocus /></Field>
        <Field label="Recipient (optional)"><Input name="recipientName" placeholder="Name" /></Field>
        <Button type="submit">Issue gift card</Button>
      </form>
    </FormPage>
  );
}
