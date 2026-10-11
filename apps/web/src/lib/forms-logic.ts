import type { FormAnswer, FormFieldDef } from "@angelic/db";

/** Is this question shown, given the answers so far? Unconditional questions always are. */
export function fieldVisible(field: FormFieldDef, answers: Record<string, FormAnswer | undefined>): boolean {
  if (!field.showIf) return true;
  const v = answers[field.showIf.fieldId];
  const want = field.showIf.equals;
  if (typeof v === "boolean") return String(v) === want;
  if (Array.isArray(v)) return v.includes(want);
  // An untouched checkbox is "not ticked", so a question that depends on that shows from the start.
  if (v === undefined || v === null) return want === "false" || want === "";
  return v === want;
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
