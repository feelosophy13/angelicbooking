import { requireAction } from "@/lib/tenant";
import { Button, Field, FormPage, Input, Textarea } from "@/components/ui";
import { createClient } from "../actions";

export default async function NewClientPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  await requireAction(slug, "clients.write");
  return (
    <FormPage title="New client" backHref={`/app/${slug}/clients`} backLabel="Clients" width="max-w-lg">
      <form action={createClient} className="space-y-3">
        <input type="hidden" name="slug" value={slug} />
        <div className="grid grid-cols-2 gap-3">
          <Field label="First name"><Input name="firstName" required autoFocus /></Field>
          <Field label="Last name"><Input name="lastName" /></Field>
        </div>
        <Field label="Mobile phone"><Input name="phone" type="tel" /></Field>
        <Field label="Email"><Input name="email" type="email" /></Field>
        <Field label="Notes"><Textarea name="notes" rows={3} placeholder="Allergies, formulas, preferences" /></Field>
        <Button type="submit">Create client</Button>
      </form>
    </FormPage>
  );
}
