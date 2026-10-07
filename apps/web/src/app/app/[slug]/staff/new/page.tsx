import type { Metadata } from "next";
import { requireAction } from "@/lib/tenant";
import { FormPage, Input } from "@/components/ui";
import { ActionForm, Field, SubmitButton } from "@/components/form";
import { createStaff } from "../actions";

export const metadata: Metadata = { title: "New staff member" };

export default async function NewStaffPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  await requireAction(slug, "staff.manage");
  return (
    <FormPage title="New staff member" backHref={`/app/${slug}/staff`} backLabel="Staff" width="max-w-lg">
      <p className="mb-4 text-sm text-stone-600">Creates a calendar column with default hours (Tue–Sat 9–5) that you can change next. To let them sign in, send an invitation afterwards.</p>
      <ActionForm action={createStaff}>
        <input type="hidden" name="slug" value={slug} />
        <Field label="Name" name="displayName" required><Input name="displayName" required autoFocus /></Field>
        <Field label="Email" name="email"><Input name="email" type="email" /></Field>
        <Field label="Phone" name="phone"><Input name="phone" /></Field>
        <Field label="Calendar colour" name="color"><Input name="color" type="color" defaultValue="#6366f1" className="h-10 w-24 p-1" /></Field>
        <SubmitButton pendingText="Creating…">Create staff member</SubmitButton>
      </ActionForm>
    </FormPage>
  );
}
