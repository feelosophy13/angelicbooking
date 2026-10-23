/**
 * Treatment charts (SOAP notes): what a provider records about a visit, on a template the salon designs. A chart is filled in as a draft,
 * then signed; a signed chart is locked, and anything learned later is an addendum with its own time and author. Pure logic here (field
 * types, the starter templates, reading answers, the lock and the permission scope) so the web app, the tests and any future client agree.
 */
import { can, type Permissions, type Role } from "./permissions";

export const CHART_FIELD_TYPES = [
  { type: "heading", label: "Section heading" },
  { type: "text", label: "Short answer" },
  { type: "textarea", label: "Long answer" },
  { type: "multiselect", label: "Checkboxes" },
  { type: "select", label: "Choose one" },
  { type: "yesno", label: "Yes / No" },
  { type: "number", label: "Number" },
  { type: "date", label: "Date" },
  { type: "diagram", label: "Face or body diagram" },
  { type: "photo", label: "Visit photos" },
  { type: "statement", label: "Instructions (no answer)" },
] as const;
export type ChartFieldType = (typeof CHART_FIELD_TYPES)[number]["type"];
export const CHART_DISPLAY_TYPES: readonly ChartFieldType[] = ["heading", "statement"];
export const CHART_DIAGRAMS = [
  { value: "face", label: "Face" },
  { value: "body", label: "Body, front and back" },
] as const;
export type ChartDiagram = (typeof CHART_DIAGRAMS)[number]["value"];

export interface ChartFieldDef {
  id: string;
  type: ChartFieldType;
  label: string;
  /** Needed before the chart can be signed (a draft may leave it blank). */
  required?: boolean;
  options?: string[];
  /** Which picture a diagram field draws. */
  diagram?: ChartDiagram;
  /** Grey hint under the label. */
  hint?: string;
}

/** A mark on a diagram: where (percent of the picture's width and height) and what. */
export interface ChartMark {
  x: number;
  y: number;
  note?: string;
}
/** Text, number and date as a string; yes/no and choose-one as the option; checkboxes and photos (visit photo ids) as a list; a diagram as its marks. */
export type ChartAnswer = string | string[] | ChartMark[];
export type ChartAnswers = Record<string, ChartAnswer>;

export const CHART_MAX_FIELDS = 80;
export const CHART_MAX_MARKS = 40;
export const CHART_MAX_TEXT = 5000;
export const CHART_MAX_ADDENDUM = 4000;

export class ChartError extends Error {
  constructor(message: string, readonly field: string | null = null) {
    super(message);
  }
}

const isType = (t: string): t is ChartFieldType => CHART_FIELD_TYPES.some((x) => x.type === t);
const isDiagram = (d: string): d is ChartDiagram => CHART_DIAGRAMS.some((x) => x.value === d);

/** The template builder posts rows as f{i}_label / f{i}_type / f{i}_required / f{i}_options / f{i}_id / f{i}_diagram / f{i}_hint; empty rows are dropped. */
export function parseChartFieldRows(raw: Record<string, string>): ChartFieldDef[] {
  const out: ChartFieldDef[] = [];
  const ids = new Set<string>();
  for (let i = 0; i < 200 && out.length < CHART_MAX_FIELDS; i++) {
    const label = (raw[`f${i}_label`] ?? "").trim();
    const type = raw[`f${i}_type`] ?? "";
    if (!label || !isType(type)) continue;
    let id = (raw[`f${i}_id`] ?? "").trim().slice(0, 40) || `f_${Math.random().toString(36).slice(2, 8)}`;
    while (ids.has(id)) id = `${id}_${out.length}`;
    ids.add(id);
    const def: ChartFieldDef = { id, type, label: label.slice(0, 1000) };
    if (!CHART_DISPLAY_TYPES.includes(type) && raw[`f${i}_required`] === "on") def.required = true;
    if (type === "select" || type === "multiselect") def.options = (raw[`f${i}_options`] ?? "").split("\n").map((s) => s.trim().slice(0, 120)).filter(Boolean).slice(0, 40);
    const hint = (raw[`f${i}_hint`] ?? "").trim().slice(0, 200);
    if (hint) def.hint = hint;
    if (type === "diagram") def.diagram = isDiagram(raw[`f${i}_diagram`] ?? "") ? (raw[`f${i}_diagram`] as ChartDiagram) : "face";
    out.push(def);
  }
  return out;
}

const clamp = (n: number) => Math.min(100, Math.max(0, Math.round(n * 10) / 10));

/** Marks posted as JSON, cleaned: inside the picture, at most CHART_MAX_MARKS, short notes. */
export function parseMarks(raw: string | null | undefined): ChartMark[] {
  if (!raw) return [];
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(v)) return [];
  return v
    .filter((m): m is { x: number; y: number; note?: unknown } => !!m && typeof m === "object" && Number.isFinite((m as ChartMark).x) && Number.isFinite((m as ChartMark).y))
    .slice(0, CHART_MAX_MARKS)
    .map((m) => {
      const note = typeof m.note === "string" ? m.note.trim().slice(0, 200) : "";
      return note ? { x: clamp(m.x), y: clamp(m.y), note } : { x: clamp(m.x), y: clamp(m.y) };
    });
}

/**
 * Read a filled chart from the posted form: `a_<fieldId>` for each answer (repeated for checkboxes and photos, JSON marks for a
 * diagram). Answers that don't fit the field (an option the template doesn't have, a photo that isn't this visit's) are dropped.
 */
export function chartAnswersFromForm(fields: ChartFieldDef[], get: (name: string) => string | null, getAll: (name: string) => string[], allowedPhotoIds: ReadonlySet<string> = new Set()): ChartAnswers {
  const out: ChartAnswers = {};
  for (const f of fields) {
    const name = `a_${f.id}`;
    if (CHART_DISPLAY_TYPES.includes(f.type)) continue;
    if (f.type === "multiselect") {
      const picked = [...new Set(getAll(name))].filter((o) => (f.options ?? []).includes(o));
      if (picked.length) out[f.id] = picked;
    } else if (f.type === "photo") {
      const picked = [...new Set(getAll(name))].filter((id) => allowedPhotoIds.has(id)).slice(0, 24);
      if (picked.length) out[f.id] = picked;
    } else if (f.type === "diagram") {
      const marks = parseMarks(get(name));
      if (marks.length) out[f.id] = marks;
    } else {
      const v = (get(name) ?? "").trim().slice(0, CHART_MAX_TEXT);
      if (!v) continue;
      if (f.type === "select" && !(f.options ?? []).includes(v)) continue;
      if (f.type === "yesno" && v !== "Yes" && v !== "No") continue;
      if (f.type === "number" && !Number.isFinite(Number(v))) throw new ChartError(`${f.label}: enter a number`, f.id);
      if (f.type === "date" && !/^\d{4}-\d{2}-\d{2}$/.test(v)) throw new ChartError(`${f.label}: enter a date`, f.id);
      out[f.id] = v;
    }
  }
  return out;
}

const answered = (v: ChartAnswer | undefined) => (Array.isArray(v) ? v.length > 0 : !!v && v.trim() !== "");

/** The first required field left blank, which stops signing (a draft may be saved with gaps). */
export function firstMissing(fields: ChartFieldDef[], answers: ChartAnswers): ChartFieldDef | null {
  return fields.find((f) => f.required && !CHART_DISPLAY_TYPES.includes(f.type) && !answered(answers[f.id])) ?? null;
}

/** A chart is locked once signed: its answers never change again, and corrections are addenda. */
export function chartLocked(note: { signedAt: Date | null }): boolean {
  return note.signedAt != null;
}

/** Throws unless the chart may still be edited. The database refuses the same change (migration 0140), this says it in words. */
export function assertChartEditable(note: { signedAt: Date | null }): void {
  if (chartLocked(note)) throw new ChartError("This chart is signed, so it can't be changed. Add an addendum instead.");
}

/** An addendum's text, trimmed; empty or too long is refused. */
export function cleanAddendum(body: string): string {
  const b = body.trim();
  if (!b) throw new ChartError("Write what you want to add.", "body");
  if (b.length > CHART_MAX_ADDENDUM) throw new ChartError(`Keep an addendum under ${CHART_MAX_ADDENDUM} characters.`, "body");
  return b;
}

/** Text for an answer on the chart, the print copy and the history list. */
export function chartAnswerText(field: ChartFieldDef, v: ChartAnswer | undefined): string {
  if (v == null) return "";
  if (field.type === "diagram") {
    const marks = Array.isArray(v) ? (v as ChartMark[]) : [];
    return marks.map((m, i) => `${i + 1}${m.note ? `. ${m.note}` : ""}`).join("; ");
  }
  if (field.type === "photo") return Array.isArray(v) ? `${v.length} photo${v.length === 1 ? "" : "s"}` : "";
  if (Array.isArray(v)) return (v as string[]).join(", ");
  return v;
}

/**
 * Whose charts a person may read or write: everyone's ("any"), their own clients' ("own": clients they have a visit with), or none.
 * Charts are their own permission, never implied by "Read notes and forms".
 */
export function chartScope(subject: Permissions | Role | string | null | undefined, mode: "read" | "write"): "any" | "own" | null {
  if (can(subject, mode === "read" ? "charts.read.any" : "charts.write.any")) return "any";
  if (can(subject, mode === "read" ? "charts.read.own" : "charts.write.own")) return "own";
  return null;
}

const t = (id: string, type: ChartFieldType, label: string, extra: Partial<ChartFieldDef> = {}): ChartFieldDef => ({ id, type, label, ...extra });

export interface StarterChartTemplate {
  key: string;
  name: string;
  blurb: string;
  /** Services whose names match get this template as their default when the salon adds it. */
  servicePattern: RegExp | null;
  fields: ChartFieldDef[];
}

/** Ready-made charts a salon starts from. The wording is a sensible default; the salon edits it to how it works. */
export const STARTER_CHART_TEMPLATES: StarterChartTemplate[] = [
  {
    key: "soap",
    name: "SOAP note",
    blurb: "Subjective, Objective, Assessment, Plan. Works for any treatment.",
    servicePattern: null,
    fields: [
      t("h_s", "heading", "Subjective"),
      t("s_concern", "textarea", "What the client tells you: concerns and goals", { required: true }),
      t("s_changes", "textarea", "Changes since the last visit", { hint: "Health, medication, pregnancy, new products, sun exposure" }),
      t("h_o", "heading", "Objective"),
      t("o_observed", "textarea", "What you see and measure", { required: true }),
      t("o_areas", "diagram", "Areas treated or of concern", { diagram: "face" }),
      t("o_photos", "photo", "Photos"),
      t("h_a", "heading", "Assessment"),
      t("a_assessment", "textarea", "Your assessment", { required: true }),
      t("h_p", "heading", "Plan"),
      t("p_today", "textarea", "Treatment today: products, settings, time", { required: true }),
      t("p_home", "textarea", "Home care and products recommended"),
      t("p_next", "text", "Next visit", { hint: "e.g. 4 weeks, series 2 of 6" }),
    ],
  },
  {
    key: "facial",
    name: "Facial treatment",
    blurb: "Skin type, Fitzpatrick, products and strengths, reaction and aftercare.",
    servicePattern: /facial|peel|dermaplan|hydra|microderm|skin/i,
    fields: [
      t("h_skin", "heading", "Skin"),
      t("skin_type", "select", "Skin type", { required: true, options: ["Normal", "Dry", "Oily", "Combination", "Sensitive"] }),
      t("fitz", "select", "Fitzpatrick type", { options: ["I", "II", "III", "IV", "V", "VI"] }),
      t("concerns", "multiselect", "Concerns", { options: ["Acne", "Congestion", "Pigmentation", "Fine lines", "Dehydration", "Redness / rosacea", "Scarring", "Enlarged pores"] }),
      t("contra", "yesno", "Any contraindications today?", { required: true, hint: "Retinoids, Accutane, recent waxing, active infection, pregnancy" }),
      t("contra_detail", "textarea", "Contraindication details"),
      t("h_tx", "heading", "Treatment"),
      t("products", "textarea", "Products and strengths used", { required: true }),
      t("minutes", "number", "Exposure time (minutes)"),
      t("extractions", "yesno", "Extractions"),
      t("areas", "diagram", "Areas treated", { diagram: "face" }),
      t("reaction", "select", "Skin reaction", { options: ["None", "Mild redness", "Moderate redness", "Frosting", "Other (see notes)"] }),
      t("photos", "photo", "Before and after photos"),
      t("h_after", "heading", "Aftercare"),
      t("aftercare", "textarea", "Aftercare given"),
      t("next", "text", "Next visit"),
    ],
  },
  {
    key: "lash",
    name: "Lash service",
    blurb: "Service, natural lash health, adhesive, retention and any reaction.",
    servicePattern: /lash/i,
    fields: [
      t("service", "select", "Service", { required: true, options: ["Classic full set", "Hybrid full set", "Volume full set", "Fill", "Lift and tint", "Removal"] }),
      t("natural", "select", "Natural lash condition", { options: ["Healthy", "Fine or sparse", "Damaged", "Shedding heavily"] }),
      t("retention", "select", "Retention since last visit", { options: ["Over 70%", "50–70%", "Under 50%", "First set"] }),
      t("adhesive", "text", "Adhesive and batch", { hint: "Brand, and the bottle's batch number" }),
      t("patch", "date", "Patch test date"),
      t("reaction", "select", "Eye reaction", { required: true, options: ["None", "Watering", "Redness", "Swelling", "Other (see notes)"] }),
      t("map", "statement", "The zone-by-zone lengths, curls and thickness go on the client's lash map."),
      t("photos", "photo", "Photos"),
      t("notes", "textarea", "Notes"),
    ],
  },
  {
    key: "pmu",
    name: "Permanent makeup",
    blurb: "Procedure, pigments, needles and settings, mapping and healing.",
    servicePattern: /microblad|pmu|permanent|powder brow|combo brow|lip blush|eyeliner|ombr/i,
    fields: [
      t("procedure", "select", "Procedure", { required: true, options: ["Microblading", "Powder brows", "Combo brows", "Lip blush", "Eyeliner", "Correction"] }),
      t("session", "select", "Session", { required: true, options: ["Initial", "Touch-up (6–8 weeks)", "Annual refresh", "Correction"] }),
      t("skin", "select", "Skin type", { options: ["Dry", "Normal", "Oily", "Combination", "Mature"] }),
      t("pigments", "textarea", "Pigments and mix", { required: true, hint: "Brand, color names and ratios" }),
      t("needle", "text", "Needle or blade"),
      t("settings", "text", "Machine settings"),
      t("numbing", "text", "Numbing used"),
      t("mapping", "diagram", "Mapping and areas worked", { diagram: "face" }),
      t("healing", "textarea", "How the last session healed"),
      t("photos", "photo", "Photos"),
      t("aftercare", "yesno", "Aftercare explained and given in writing"),
      t("notes", "textarea", "Notes"),
    ],
  },
  {
    key: "massage",
    name: "Massage",
    blurb: "Pressure, areas of tension on a body chart, techniques and response.",
    servicePattern: /massage|bodywork|reflexolog/i,
    fields: [
      t("h_before", "heading", "Before"),
      t("complaint", "textarea", "What the client wants worked on"),
      t("contra", "multiselect", "Contraindications checked", { options: ["None", "Recent injury or surgery", "Pregnancy", "Blood thinners", "High blood pressure", "Skin condition", "Varicose veins"] }),
      t("pressure", "select", "Pressure", { required: true, options: ["Light", "Medium", "Firm", "Deep"] }),
      t("h_session", "heading", "Session"),
      t("tension", "diagram", "Areas of tension and work", { diagram: "body" }),
      t("techniques", "multiselect", "Techniques", { options: ["Swedish", "Deep tissue", "Trigger point", "Myofascial release", "Stretching", "Hot stone", "Cupping", "Lymphatic"] }),
      t("oil", "text", "Oil or lotion used"),
      t("h_after", "heading", "After"),
      t("response", "textarea", "Client response", { required: true }),
      t("recommend", "textarea", "Recommendations and self-care"),
    ],
  },
];

export function starterChartTemplate(key: string | null | undefined): StarterChartTemplate | null {
  return STARTER_CHART_TEMPLATES.find((s) => s.key === key) ?? null;
}
