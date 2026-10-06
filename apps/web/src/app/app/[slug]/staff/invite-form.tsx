"use client";
import { useActionState } from "react";
import { inviteStaff, type InviteState } from "./actions";
import { Button, Field, Input, Notice, Select } from "@/components/ui";

export function InviteForm({ slug }: { slug: string }) {
  const [state, action, pending] = useActionState<InviteState, FormData>(inviteStaff, undefined);
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="slug" value={slug} />
      <Field label="Email"><Input name="email" type="email" required placeholder="stylist@example.com" /></Field>
      <Field label="Role">
        <Select name="role" defaultValue="provider">
          <option value="provider">Provider (own calendar only)</option>
          <option value="front_desk">Front desk (all calendars, checkout)</option>
          <option value="manager">Manager (everything except billing)</option>
        </Select>
      </Field>
      {state?.error ? <Notice>{state.error}</Notice> : null}
      {state?.ok && state.link ? (
        <Notice kind="success">
          Invitation created. Send them this link:
          <input readOnly value={state.link} className="mt-1 w-full rounded border border-green-300 bg-white px-2 py-1 text-xs" onFocus={(e) => e.currentTarget.select()} />
        </Notice>
      ) : null}
      <Button type="submit" variant="secondary" className="w-full" disabled={pending}>{pending ? "…" : "Create invitation"}</Button>
    </form>
  );
}
