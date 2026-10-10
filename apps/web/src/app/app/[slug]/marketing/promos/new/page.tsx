import type { Metadata } from "next";
import { asc, eq } from "drizzle-orm";
import { schema, withTenant } from "@angelic/db";
import { requireAction } from "@/lib/tenant";
import { Card, Input, Select } from "@/components/ui";
import { ActionForm, Field, SubmitButton } from "@/components/form";
import { createPromo } from "../../actions";

export const metadata: Metadata = { title: "New promo code" };

export default async function NewPromoPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { business } = await requireAction(slug, "reports.view");
  const services = await withTenant(business.id, (tx) => tx.select({ id: schema.services.id, name: schema.services.name }).from(schema.services).where(eq(schema.services.active, true)).orderBy(asc(schema.services.name)));
  return (
    <Card className="max-w-2xl p-5">
      <ActionForm action={createPromo}>
        <input type="hidden" name="slug" value={slug} />
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Code" name="code" required><Input name="code" required placeholder="WELCOME20" className="font-mono uppercase" autoFocus /></Field>
          <Field label="Type" name="type"><Select name="type" defaultValue="percent"><option value="percent">% off</option><option value="amount">$ off</option></Select></Field>
          <Field label="Value" name="value" required><Input name="value" required placeholder="20" inputMode="decimal" /></Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Starts" name="startsAt"><Input name="startsAt" type="date" /></Field>
          <Field label="Expires" name="expiresAt"><Input name="expiresAt" type="date" /></Field>
          <Field label="Max uses" name="maxUses" hint="Blank = unlimited"><Input name="maxUses" type="number" min={1} /></Field>
        </div>
        <Field label="Minimum subtotal" name="minSubtotal"><Input name="minSubtotal" inputMode="decimal" placeholder="0" className="w-40" /></Field>
        <fieldset className="rounded-lg border border-stone-200 p-3">
          <legend className="px-1 text-sm font-medium text-stone-700">Only for these services (optional)</legend>
          <div className="grid gap-1 sm:grid-cols-2">
            {services.map((s) => <label key={s.id} className="flex items-center gap-2 text-sm"><input type="checkbox" name="serviceIds" value={s.id} className="h-4 w-4 accent-brand-600" /> {s.name}</label>)}
          </div>
        </fieldset>
        <SubmitButton pendingText="Creating…">Create code</SubmitButton>
      </ActionForm>
    </Card>
  );
}
