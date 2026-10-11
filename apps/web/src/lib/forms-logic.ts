import type { FormAnswer, FormFieldDef, FormFieldType } from "@angelic/db";

/** Question types offered in the builder, in menu order. Client-safe (no db import). */
export const FIELD_TYPES: { type: FormFieldType; label: string }[] = [
  { type: "text", label: "Short answer" },
  { type: "textarea", label: "Paragraph" },
  { type: "yesno", label: "Yes / No" },
  { type: "select", label: "Choose one" },
  { type: "multiselect", label: "Choose any" },
  { type: "number", label: "Number" },
  { type: "date", label: "Date" },
  { type: "phone", label: "Phone number" },
  { type: "email", label: "Email address" },
  { type: "file", label: "Photo or PDF upload" },
  { type: "checkbox", label: "Agreement box (must tick)" },
  { type: "initials", label: "Initials" },
  { type: "statement", label: "Statement (no answer)" },
  { type: "heading", label: "Section heading" },
];

/** Types that take no answer. */
export const DISPLAY_TYPES: FormFieldType[] = ["statement", "heading"];
/** Types whose answer can drive a "show only when" condition on a later question. */
export const DRIVER_TYPES: FormFieldType[] = ["checkbox", "yesno", "select", "multiselect"];

/** Which client-record targets make sense for a question type. */
export function mapTargetsFor(type: FormFieldType): { value: NonNullable<FormFieldDef["mapTo"]>; label: string }[] {
  if (type === "email") return [{ value: "email", label: "Client's email" }, { value: "notes", label: "Client notes" }];
  if (type === "phone") return [{ value: "phone", label: "Client's phone" }, { value: "notes", label: "Client notes" }];
  if (type === "date") return [{ value: "birthday", label: "Client's birthday" }, { value: "notes", label: "Client notes" }];
  if (type === "yesno" || type === "checkbox") return [{ value: "tag", label: "A tag on the client" }, { value: "notes", label: "Client notes" }];
  if (type === "text" || type === "textarea" || type === "select" || type === "multiselect" || type === "number") return [{ value: "notes", label: "Client notes" }];
  return [];
}

/** Is this question shown, given the answers so far? Unconditional questions always are. */
export function fieldVisible(field: FormFieldDef, answers: Record<string, FormAnswer | undefined>): boolean {
  if (!field.showIf) return true;
  const v = answers[field.showIf.fieldId];
  const want = field.showIf.equals;
  if (typeof v === "boolean") return String(v) === want;
  if (Array.isArray(v)) return v.includes(want);
  // An untouched box is "not ticked", so a question that depends on that shows from the start.
  if (v === undefined || v === null) return want === "false" || want === "";
  return v === want;
}

/** Drop answers to questions that are hidden by the current answers, so a changed driver leaves no stale state behind. */
export function clearHidden(fields: FormFieldDef[], answers: Record<string, FormAnswer | undefined>): Record<string, FormAnswer | undefined> {
  const out: Record<string, FormAnswer | undefined> = { ...answers };
  for (const f of fields) if (!fieldVisible(f, out)) out[f.id] = undefined;
  return out;
}

/** Human-readable answer for a field (statements excluded). */
export function answerText(field: FormFieldDef, v: FormAnswer | undefined): string {
  if (field.type === "checkbox") return v === true ? "Yes" : "No";
  if (Array.isArray(v)) return v.join(", ");
  return typeof v === "string" ? v : "";
}

export function answersEqual(a: FormAnswer | undefined, b: FormAnswer | undefined): boolean {
  if (Array.isArray(a) || Array.isArray(b)) return JSON.stringify(a ?? []) === JSON.stringify(b ?? []);
  return (a ?? "") === (b ?? "");
}
