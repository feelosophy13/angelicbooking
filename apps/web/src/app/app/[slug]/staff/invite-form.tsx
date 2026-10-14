"use client";
import { useActionState } from "react";
import { inviteStaff, type InviteState } from "./actions";
import { Field, Input, Notice, Select } from "@/components/ui";
import { SubmitButton } from "@/components/form";
import { isAction, worksOwnCalendar } from "@angelic/core";

export function InviteForm({ slug, roles, defaultEmail }: { slug: string; roles: { key: string; name: string; description: string | null; permissions?: string[] }[]; defaultEmail?: string }) {
  // Offer first the kind of role that works their own calendar (a stylist), found by what the role can do, not by what it is called.
  const invitable = roles.filter((r) => r.key !== "owner");
  const defaultRole = invitable.find((r) => worksOwnCalendar(new Set((r.permissions ?? []).filter(isAction))))?.key ?? invitable[0]?.key;
  const [state, action] = useActionState<InviteState, FormData>(inviteStaff, undefined);
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="slug" value={slug} />
      <Field label="Email"><Input name="email" type="email" required placeholder="stylist@example.com" defaultValue={defaultEmail} /></Field>
      <Field label="Role">
        <Select name="role" defaultValue={defaultRole}>
          {invitable.map((r) => <option key={r.key} value={r.key}>{r.name}{r.description ? ` — ${r.description}` : ""}</option>)}
        </Select>
      </Field>
      {state?.error ? <Notice>{state.error}</Notice> : null}
      {state?.ok && state.link ? (
        <Notice kind="success">
          Invitation created. Send them this link:
          <input readOnly value={state.link} className="mt-1 w-full rounded border border-green-300 bg-white px-2 py-1 text-xs" onFocus={(e) => e.currentTarget.select()} />
        </Notice>
      ) : null}
      <SubmitButton variant="secondary" className="w-full" pendingText="Creating…">Create invitation</SubmitButton>
    </form>
  );
}
