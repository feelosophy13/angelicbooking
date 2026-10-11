import { describe, expect, it } from "vitest";
import { answerText, answersEqual, clearHidden, fieldVisible } from "../forms-logic";
import type { FormFieldDef } from "@angelic/db";
import { parseFieldRows } from "@/server/forms";

describe("fieldVisible", () => {
  it("shows unconditional fields and honours checkbox / select conditions", () => {
    expect(fieldVisible({ id: "a", type: "text", label: "A" }, {})).toBe(true);
    const dep = { id: "b", type: "text" as const, label: "B", showIf: { fieldId: "a", equals: "true" } };
    expect(fieldVisible(dep, { a: true })).toBe(true);
    expect(fieldVisible(dep, { a: false })).toBe(false);
    expect(fieldVisible(dep, {})).toBe(false);
    const unticked = { id: "d", type: "text" as const, label: "D", showIf: { fieldId: "a", equals: "false" } };
    expect(fieldVisible(unticked, {})).toBe(true);
    expect(fieldVisible(unticked, { a: false })).toBe(true);
    expect(fieldVisible(unticked, { a: true })).toBe(false);
    const sel = { id: "c", type: "text" as const, label: "C", showIf: { fieldId: "s", equals: "Yes" } };
    expect(fieldVisible(sel, { s: "Yes" })).toBe(true);
    expect(fieldVisible(sel, { s: ["No", "Yes"] })).toBe(true);
    expect(fieldVisible(sel, { s: "No" })).toBe(false);
  });
});

describe("answerText / answersEqual", () => {
  it("renders and compares every answer shape", () => {
    expect(answerText({ id: "x", type: "checkbox", label: "" }, true)).toBe("Yes");
    expect(answerText({ id: "x", type: "multiselect", label: "" }, ["a", "b"])).toBe("a, b");
    expect(answersEqual(["a"], ["a"])).toBe(true);
    expect(answersEqual("a", undefined)).toBe(false);
    expect(answersEqual("", undefined)).toBe(true);
  });
});

describe("parseFieldRows", () => {
  it("keeps conditions only when they point at an earlier question", () => {
    const defs = parseFieldRows({
      f0_id: "q1", f0_label: "Allergies?", f0_type: "checkbox",
      f1_id: "q2", f1_label: "Which?", f1_type: "textarea", f1_required: "on", f1_showif_field: "q1", f1_showif_value: "true",
      f2_id: "q3", f2_label: "Later ref", f2_type: "text", f2_showif_field: "q9", f2_showif_value: "x",
      f3_id: "q4", f3_label: "Pick", f3_type: "multiselect", f3_options: "A\nB\n\nC",
    });
    expect(defs.map((d) => d.id)).toEqual(["q1", "q2", "q3", "q4"]);
    expect(defs[1]!.showIf).toEqual({ fieldId: "q1", equals: "true" });
    expect(defs[2]!.showIf).toBeUndefined();
    expect(defs[3]!.options).toEqual(["A", "B", "C"]);
  });
});

describe("yes/no drivers and hidden answers", () => {
  const q: FormFieldDef = { id: "preg", type: "yesno", label: "Pregnant?" };
  const dep: FormFieldDef = { id: "weeks", type: "number", label: "How many weeks?", showIf: { fieldId: "preg", equals: "Yes" } };
  it("shows a dependent only on the matching yes/no answer", () => {
    expect(fieldVisible(dep, { preg: "Yes" })).toBe(true);
    expect(fieldVisible(dep, { preg: "No" })).toBe(false);
    expect(fieldVisible(dep, {})).toBe(false);
  });
  it("clears the answer of a question that becomes hidden", () => {
    const after = clearHidden([q, dep], { preg: "No", weeks: "12" });
    expect(after.weeks).toBeUndefined();
    expect(clearHidden([q, dep], { preg: "Yes", weeks: "12" }).weeks).toBe("12");
  });
});
