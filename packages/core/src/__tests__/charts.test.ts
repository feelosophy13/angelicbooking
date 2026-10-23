import { describe, expect, it } from "vitest";
import {
  assertChartEditable, CHART_DISPLAY_TYPES, CHART_FIELD_TYPES, CHART_MAX_MARKS, ChartError, chartAnswersFromForm, chartAnswerText, chartLocked, chartScope, cleanAddendum, firstMissing,
  parseChartFieldRows, parseMarks, STARTER_CHART_TEMPLATES, starterChartTemplate, type ChartFieldDef,
} from "../charts";
import { DEFAULT_ROLE_PERMISSIONS, PERMISSION_GROUPS } from "../permissions";

describe("starter chart templates", () => {
  it("ship SOAP, facial, lash, PMU and massage", () => {
    expect(STARTER_CHART_TEMPLATES.map((s) => s.key)).toEqual(["soap", "facial", "lash", "pmu", "massage"]);
    expect(starterChartTemplate("soap")!.name).toBe("SOAP note");
    expect(starterChartTemplate("nope")).toBeNull();
  });
  it("SOAP has the four sections in order", () => {
    const headings = starterChartTemplate("soap")!.fields.filter((f) => f.type === "heading").map((f) => f.label);
    expect(headings).toEqual(["Subjective", "Objective", "Assessment", "Plan"]);
  });
  for (const s of STARTER_CHART_TEMPLATES) {
    it(`${s.key}: unique ids, known types, choices have options, diagrams name a picture, something to sign`, () => {
      const ids = s.fields.map((f) => f.id);
      expect(new Set(ids).size).toBe(ids.length);
      for (const f of s.fields) {
        expect(CHART_FIELD_TYPES.some((t) => t.type === f.type), f.id).toBe(true);
        if (f.type === "select" || f.type === "multiselect") expect(f.options?.length, f.id).toBeGreaterThan(1);
        if (f.type === "diagram") expect(["face", "body"]).toContain(f.diagram);
        if (CHART_DISPLAY_TYPES.includes(f.type)) expect(f.required, f.id).toBeFalsy();
      }
      expect(s.fields.some((f) => f.required)).toBe(true);
    });
  }
  it("starters suit services by name", () => {
    const pick = (name: string) => STARTER_CHART_TEMPLATES.find((s) => s.servicePattern?.test(name))?.key ?? "soap";
    expect(pick("Classic Lash Fill")).toBe("lash");
    expect(pick("Signature Facial")).toBe("facial");
    expect(pick("Microblading touch-up")).toBe("pmu");
    expect(pick("Deep Tissue Massage 60")).toBe("massage");
    expect(pick("Botox consult")).toBe("soap");
  });
  it("round-trips through the builder's posted rows", () => {
    const s = starterChartTemplate("massage")!;
    const raw: Record<string, string> = {};
    s.fields.forEach((f, i) => {
      raw[`f${i}_id`] = f.id;
      raw[`f${i}_label`] = f.label;
      raw[`f${i}_type`] = f.type;
      if (f.required) raw[`f${i}_required`] = "on";
      if (f.options) raw[`f${i}_options`] = f.options.join("\n");
      if (f.diagram) raw[`f${i}_diagram`] = f.diagram;
      if (f.hint) raw[`f${i}_hint`] = f.hint;
    });
    expect(parseChartFieldRows(raw)).toEqual(s.fields);
  });
});

describe("parseChartFieldRows", () => {
  it("drops empty and unknown rows, defaults the diagram, never requires a heading, de-duplicates ids", () => {
    const out = parseChartFieldRows({
      f0_id: "a", f0_label: "Notes", f0_type: "textarea", f0_required: "on",
      f1_id: "b", f1_label: "", f1_type: "text",
      f2_id: "c", f2_label: "Weird", f2_type: "signature",
      f3_id: "d", f3_label: "Where", f3_type: "diagram", f3_diagram: "elbow",
      f4_id: "e", f4_label: "Section", f4_type: "heading", f4_required: "on",
      f5_id: "a", f5_label: "Again", f5_type: "text",
    });
    expect(out.map((f) => f.id)).toEqual(["a", "d", "e", "a_3"]);
    expect(out[0]!.required).toBe(true);
    expect(out[1]!.diagram).toBe("face");
    expect(out[2]!.required).toBeUndefined();
  });
});

describe("reading a filled chart", () => {
  const fields: ChartFieldDef[] = [
    { id: "h", type: "heading", label: "Section" },
    { id: "skin", type: "select", label: "Skin", options: ["Dry", "Oily"], required: true },
    { id: "c", type: "multiselect", label: "Concerns", options: ["Acne", "Redness"] },
    { id: "yn", type: "yesno", label: "Extractions" },
    { id: "min", type: "number", label: "Minutes" },
    { id: "when", type: "date", label: "Patch test" },
    { id: "map", type: "diagram", label: "Areas", diagram: "face" },
    { id: "pics", type: "photo", label: "Photos" },
    { id: "notes", type: "textarea", label: "Notes", required: true },
  ];
  const read = (form: Record<string, string | string[]>, photos: string[] = []) =>
    chartAnswersFromForm(fields, (n) => { const v = form[n]; return Array.isArray(v) ? v[0] ?? null : v ?? null; }, (n) => { const v = form[n]; return Array.isArray(v) ? v : v ? [v] : []; }, new Set(photos));

  it("keeps answers that fit their field and drops the rest", () => {
    const a = read({ a_skin: "Wet", a_c: ["Acne", "Hives", "Acne"], a_yn: "Maybe", a_min: "12", a_when: "2026-10-01", a_map: JSON.stringify([{ x: 140, y: -3, note: " cheek " }, { x: "a" }]), a_pics: ["p1", "p9"], a_notes: "  went well  " }, ["p1"]);
    expect(a).toEqual({ c: ["Acne"], min: "12", when: "2026-10-01", map: [{ x: 100, y: 0, note: "cheek" }], pics: ["p1"], notes: "went well" });
  });
  it("refuses a number or date that isn't one, naming the field", () => {
    expect(() => read({ a_min: "twelve" })).toThrow(ChartError);
    try { read({ a_when: "next week" }); } catch (e) { expect((e as ChartError).field).toBe("when"); }
  });
  it("a draft may have gaps; signing names the first required field left blank", () => {
    expect(firstMissing(fields, {})?.id).toBe("skin");
    expect(firstMissing(fields, { skin: "Dry" })?.id).toBe("notes");
    expect(firstMissing(fields, { skin: "Dry", notes: "ok" })).toBeNull();
  });
  it("diagram marks are capped and kept inside the picture", () => {
    const many = JSON.stringify(Array.from({ length: CHART_MAX_MARKS + 10 }, (_, i) => ({ x: i, y: i })));
    expect(parseMarks(many)).toHaveLength(CHART_MAX_MARKS);
    expect(parseMarks("not json")).toEqual([]);
  });
  it("answers read as text for the list and the print copy", () => {
    expect(chartAnswerText(fields[2]!, ["Acne", "Redness"])).toBe("Acne, Redness");
    expect(chartAnswerText(fields[6]!, [{ x: 1, y: 2, note: "chin" }, { x: 3, y: 4 }])).toBe("1. chin; 2");
    expect(chartAnswerText(fields[7]!, ["a", "b"])).toBe("2 photos");
  });
});

describe("the signing lock and addenda", () => {
  it("a signed chart is locked", () => {
    expect(chartLocked({ signedAt: null })).toBe(false);
    expect(chartLocked({ signedAt: new Date() })).toBe(true);
    expect(() => assertChartEditable({ signedAt: null })).not.toThrow();
    expect(() => assertChartEditable({ signedAt: new Date() })).toThrow(/addendum/);
  });
  it("an addendum is trimmed and may not be empty or huge", () => {
    expect(cleanAddendum("  called back, fine  ")).toBe("called back, fine");
    expect(() => cleanAddendum("   ")).toThrow(ChartError);
    expect(() => cleanAddendum("x".repeat(4001))).toThrow(ChartError);
  });
});

describe("chart permissions", () => {
  it("own and any, with any winning; the desk has none by default", () => {
    expect(chartScope("owner", "read")).toBe("any");
    expect(chartScope("manager", "write")).toBe("any");
    expect(chartScope("provider", "read")).toBe("own");
    expect(chartScope("provider", "write")).toBe("own");
    expect(chartScope("front_desk", "read")).toBeNull();
    expect(chartScope(new Set(["charts.read.own", "charts.read.any"] as const), "read")).toBe("any");
    expect(chartScope(new Set(["charts.read.any"] as const), "write")).toBeNull();
  });
  it("are not implied by Read notes and forms", () => {
    expect(DEFAULT_ROLE_PERMISSIONS.front_desk.has("clients.notes")).toBe(true);
    expect(chartScope(DEFAULT_ROLE_PERMISSIONS.front_desk, "read")).toBeNull();
  });
  it("are listed under Clients in the role editor", () => {
    const listed = PERMISSION_GROUPS.find((g) => g.title === "Clients")!.items.map((i) => i.action);
    for (const a of ["charts.read.own", "charts.read.any", "charts.write.own", "charts.write.any"]) expect(listed).toContain(a);
  });
});
