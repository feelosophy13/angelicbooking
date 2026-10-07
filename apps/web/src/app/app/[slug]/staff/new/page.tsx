import { requireAction } from "@/lib/tenant";
import { Button, Field, FormPage, Input } from "@/components/ui";
import { createStaff } from "../actions";

export default async function NewStaffPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  await requireAction(slug, "staff.manage");
  return (
    <FormPage title="New staff member" backHref={`/app/${slug}/staff`} backLabel="Staff" width="max-w-lg">
      <p className="mb-4 text-sm text-stone-600">Creates a calendar column with default hours (Tue–Sat 9–5) that you can change next. To let them sign in, send an invitation afterwards.</p>
      <form action={createStaff} className="space-y-3">
        <input type="hidden" name="slug" value={slug} />
        <Field label="Name"><Input name="displayName" required autoFocus /></Field>
        <Field label="Email"><Input name="email" type="email" /></Field>
        <Field label="Phone"><Input name="phone" /></Field>
        <Field label="Calendar colour"><Input name="color" type="color" defaultValue="#6366f1" className="h-10 w-24 p-1" /></Field>
        <Button type="submit">Create staff member</Button>
      </form>
    </FormPage>
  );
}
