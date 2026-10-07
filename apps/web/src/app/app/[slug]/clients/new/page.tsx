import type { Metadata } from "next";
import { requireAction } from "@/lib/tenant";
import { FormPage, Input, Textarea } from "@/components/ui";
import { ActionForm, Field, SubmitButton } from "@/components/form";
import { createClient } from "../actions";

export const metadata: Metadata = { title: "New client" };

export default async function NewClientPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  await requireAction(slug, "clients.write");
  return (
    <FormPage title="New client" backHref={`/app/${slug}/clients`} backLabel="Clients" width="max-w-lg">
      <ActionForm action={createClient}>
        <input type="hidden" name="slug" value={slug} />
        <div className="grid grid-cols-2 gap-3">
          <Field label="First name" name="firstName" required><Input name="firstName" required autoFocus /></Field>
          <Field label="Last name" name="lastName"><Input name="lastName" /></Field>
        </div>
        <Field label="Mobile phone" name="phone" hint="Used for text confirmations and reminders."><Input name="phone" type="tel" /></Field>
        <Field label="Email" name="email"><Input name="email" type="email" /></Field>
        <Field label="Notes" name="notes"><Textarea name="notes" rows={3} placeholder="Allergies, formulas, preferences" /></Field>
        <SubmitButton pendingText="Creating…">Create client</SubmitButton>
      </ActionForm>
    </FormPage>
  );
}
