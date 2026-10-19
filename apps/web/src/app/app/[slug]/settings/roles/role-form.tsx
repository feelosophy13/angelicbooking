import { PERMISSION_GROUPS } from "@angelic/core";
import { Input, Textarea, Checkbox } from "@/components/ui";
import { ActionForm, Field, SubmitButton } from "@/components/form";
import type { FormState } from "@/lib/form";

export function RoleForm(props: { action: (prev: FormState | undefined, fd: FormData) => Promise<FormState>; slug: string; roleId?: string; defaults?: { name: string; description: string | null; permissions: string[] }; submitLabel: string }) {
  const d = props.defaults;
  const has = (a: string) => d?.permissions.includes(a) ?? false;
  return (
    <ActionForm action={props.action}>
      <input type="hidden" name="slug" value={props.slug} />
      {props.roleId ? <input type="hidden" name="roleId" value={props.roleId} /> : null}
      <div className="space-y-4">
        <Field label="Role name" name="name" required><Input name="name" defaultValue={d?.name ?? ""} placeholder="Senior stylist" required autoFocus={!props.roleId} /></Field>
        <Field label="Description" name="description" hint="Shown when assigning the role."><Textarea name="description" rows={4} defaultValue={d?.description ?? ""} /></Field>
        <div className="space-y-5">
          <p className="text-sm font-medium text-stone-700">Permissions</p>
          {PERMISSION_GROUPS.map((g) => (
            <div key={g.title}>
              <p className="text-xs font-semibold uppercase tracking-wide text-stone-400">{g.title}</p>
              <p className="mb-2 text-xs text-stone-500">{g.description}</p>
              <div className="grid gap-2 sm:grid-cols-2">
                {g.items.map((it) => (
                  <Checkbox key={it.action} name="permissions" value={it.action} defaultChecked={has(it.action)} label={<span className="font-medium">{it.label}</span>} hint={it.description} className="cursor-pointer rounded-lg border border-stone-200 p-3 hover:bg-stone-50 has-[:checked]:border-brand-300 has-[:checked]:bg-brand-50/40" />
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
      <SubmitButton pendingText="Saving…">{props.submitLabel}</SubmitButton>
    </ActionForm>
  );
}
