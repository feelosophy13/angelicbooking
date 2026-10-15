"use client";
import { ActionForm, Field, SubmitButton } from "@/components/form";
import { Input } from "@/components/ui";
import { addTextSenderAsClient } from "./actions";

/** Save a number that texted in as a client; the conversation moves onto their record and can be replied to. */
export function AddClient({ slug, number }: { slug: string; number: string }) {
  return (
    <ActionForm action={addTextSenderAsClient}>
      <input type="hidden" name="slug" value={slug} />
      <input type="hidden" name="number" value={number} />
      <p className="mb-3 text-sm text-stone-600">This number is not on a client record. Add them to reply by text and keep their history together.</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="First name" name="firstName"><Input name="firstName" required /></Field>
        <Field label="Last name" name="lastName"><Input name="lastName" /></Field>
      </div>
      <SubmitButton pendingText="Adding…">Add as client</SubmitButton>
    </ActionForm>
  );
}
