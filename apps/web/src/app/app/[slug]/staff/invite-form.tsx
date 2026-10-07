"use client";
import { useActionState } from "react";
import { inviteStaff, type InviteState } from "./actions";
import { Field, Input, Notice, Select } from "@/components/ui";
import { SubmitButton } from "@/components/form";

export function InviteForm({ slug, roles, defaultEmail }: { slug: string; roles: { key: string; name: string; description: string | null }[]; defaultEmail?: string }) {
  const [state, action] = useActionState<InviteState, FormData>(inviteStaff, undefined);
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="slug" value={slug} />
      <Field label="Email"><Input name="email" type="email" required placeholder="stylist@example.com" defaultValue={defaultEmail} /></Field>
      <Field label="Role">
        <Select name="role" defaultValue={roles.find((r) => r.key === "provider")?.key ?? roles[0]?.key}>
          {roles.filter((r) => r.key !== "owner").map((r) => <option key={r.key} value={r.key}>{r.name}{r.description ? ` — ${r.description}` : ""}</option>)}
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
