"use client";
import type { FormAnswer, FormFieldDef } from "@angelic/db";
import { FormFill } from "@/components/form-fill";
import { submitPublicForm } from "./actions";

export function PublicForm({ slug, token, form, clientName, defaults }: { slug: string; token: string; form: { id: string; name: string; description: string | null; fields: FormFieldDef[]; requireSignature: boolean }; clientName: string; defaults?: Record<string, FormAnswer> | null }) {
  return <FormFill action={submitPublicForm} hidden={{ slug, token, formId: form.id }} form={form} clientName={clientName} defaults={defaults} />;
}
