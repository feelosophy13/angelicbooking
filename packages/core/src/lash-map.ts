/**
 * Lash maps: how a stylist sets a client's lash extensions, zone by zone from the inner corner to the outer corner. One map covers both
 * eyes unless the right eye is set differently, when the map's zones are the left eye and `rightZones` the right. A zone can also carry a
 * spike: longer lashes on the divider after it (wispy and spiky styles), written on the line between two zones as printed lash maps do.
 * Each zone and spike has length, curl, thickness, shape (round, or flat: ellipse / split-tip lashes, lighter than a round lash of the
 * same size), type (classic, hybrid, handmade volume or a premade fan) and colour (blank is black).
 */

export const LASH_CURLS = ["B", "C", "CC", "D", "DD", "J", "L", "L+", "M", "U"] as const;
export const LASH_THICKNESS_PRESETS = [0.03, 0.05, 0.07, 0.1, 0.12, 0.15, 0.18, 0.2] as const;
/**
 * What goes on each natural lash, grouped as the editor shows them: one classic lash, a handmade volume fan of n lashes, or a premade
 * fan (YY, W shapes, closed spike fans). A handmade 3D and a premade 3D W are different products, so both are listed. A hybrid mixes
 * classics with one fan and is stored with it ("Hybrid 3D"); a bare "Hybrid" from before fans were recorded stays valid. Flat is a
 * shape, not a type (see LashSet.flat).
 */
export const LASH_TYPE_GROUPS = [
  { label: "Classic", types: ["Classic"] },
  { label: "Handmade fans", types: ["2D", "3D", "4D", "5D", "6D", "8D", "10D"] },
  { label: "Premade fans", types: ["YY", "3D W", "4D W", "5D W", "6D W", "Spike"] },
] as const;
/** Fans a hybrid can mix with classics (every fan but closed spikes). */
export const LASH_HYBRID_FANS: readonly string[] = LASH_TYPE_GROUPS.slice(1).flatMap((g) => g.types).filter((t) => t !== "Spike");
export const LASH_TYPES: readonly string[] = [...LASH_TYPE_GROUPS.flatMap((g) => g.types), "Hybrid", ...LASH_HYBRID_FANS.map((f) => `Hybrid ${f}`)];
/** The fan in a hybrid type ("Hybrid 3D" → "3D"), "" for a bare "Hybrid", null when the type isn't a hybrid. */
export function lashHybridFan(type: string | null | undefined): string | null {
  return type === "Hybrid" ? "" : type?.startsWith("Hybrid ") ? type.slice(7) : null;
}
/** Common colours besides black (black is the default and is stored as blank). Any short colour name is accepted too. */
export const LASH_COLOR_PRESETS = ["Brown", "Dark brown", "Blue", "Purple", "Red", "Pink", "Green", "White"] as const;
export const LASH_LENGTH_MIN = 4;
export const LASH_LENGTH_MAX = 20;
export const LASH_THICKNESS_MIN = 0.03;
export const LASH_THICKNESS_MAX = 0.2;
export const LASH_ZONE_COUNTS = [6, 7] as const;
/** How much longer a new spike starts than the longer of the two zones beside it. */
export const LASH_SPIKE_EXTRA = 2;

/** One setting: a zone, or a spike on a divider. */
export interface LashSet {
  /** Millimetres, in half-millimetre steps. Null while still blank. */
  length: number | null;
  curl: string | null;
  /** Millimetres. For flat lashes, the size on the tray (the wide side). */
  thickness: number | null;
  /** Flat (ellipse / split-tip) rather than round. Absent is round. */
  flat?: boolean;
  /** One of LASH_TYPES. Absent on maps saved before types existed. */
  type?: string | null;
  /** Null (or absent) is black. */
  color?: string | null;
}

export interface LashZone extends LashSet {
  /** Spike on the divider between this zone and the next (never on the last zone). */
  spike?: LashSet | null;
}

export const emptyLashZone = (): LashZone => ({ length: null, curl: null, thickness: null, flat: false, type: null, color: null, spike: null });

/** A gentle cat-eye starting point so a new map isn't a wall of blanks. */
export function starterLashZones(count: number): LashZone[] {
  const lengths = count === 7 ? [8, 9, 10, 11, 12, 12, 11] : [8, 9, 10, 11, 12, 11];
  return lengths.map((length) => ({ length, curl: "C", thickness: 0.07, flat: false, type: null, color: null, spike: null }));
}

/**
 * Length shapes a tech starts from, as millimetres short of the longest length, inner corner to outer corner. Cat eye rises to the outer
 * corner; doll eye peaks in the middle; squirrel peaks two-thirds out then drops; open eye peaks over the pupil, softer at both ends.
 */
const LENGTH_STYLES = {
  Natural: { 6: [-4, -3, -2, -1, 0, -1], 7: [-4, -3, -2, -1, 0, 0, -1] },
  "Cat eye": { 6: [-5, -4, -3, -2, -1, 0], 7: [-5, -4, -3, -2, -1, 0, 0] },
  "Doll eye": { 6: [-3, -2, 0, 0, -2, -3], 7: [-3, -2, -1, 0, -1, -2, -3] },
  Squirrel: { 6: [-4, -3, -1, 0, -1, -3], 7: [-4, -3, -2, -1, 0, -1, -3] },
  "Open eye": { 6: [-3, -1, 0, 0, -1, -2], 7: [-3, -2, -1, 0, 0, -1, -2] },
} as const;
export const LASH_LENGTH_STYLES = Object.keys(LENGTH_STYLES) as (keyof typeof LENGTH_STYLES)[];

/** Zone lengths for a style and longest length, each kept within the allowed range. */
export function lashLengthStyle(style: (typeof LASH_LENGTH_STYLES)[number], count: number, longest: number): number[] {
  const offsets = LENGTH_STYLES[style][count === 7 ? 7 : 6];
  return offsets.map((o) => Math.min(LASH_LENGTH_MAX, Math.max(LASH_LENGTH_MIN, longest + o)));
}

/** A new spike on the divider after zone `i`: a little longer than its neighbours, otherwise like the zone after it (but a spike fan). */
export function newLashSpike(zones: LashZone[], i: number): LashSet {
  const a = zones[i];
  const b = zones[i + 1] ?? a;
  const base = Math.max(a?.length ?? 0, b?.length ?? 0) || 10;
  return { length: Math.min(LASH_LENGTH_MAX, base + LASH_SPIKE_EXTRA), curl: b?.curl ?? null, thickness: b?.thickness ?? null, flat: b?.flat ?? false, type: "Spike", color: b?.color ?? null };
}

/** "0.07" → ".07": how thickness is written on lash trays. */
export function formatLashThickness(t: number): string {
  return t.toFixed(Math.abs(t * 100 - Math.round(t * 100)) < 1e-6 ? 2 : 3).replace(/^0/, "");
}

/** "3D" → "3D volume", "Spike" → "Spike fans", "Hybrid 3D" → "Hybrid (classic + 3D)"; the rest read as they are ("Classic", "YY", "4D W"). */
export function formatLashType(type: string): string {
  const fan = lashHybridFan(type);
  if (fan) return `Hybrid (classic + ${fan})`;
  if (/^\d+D$/.test(type)) return `${type} volume`;
  return type === "Spike" ? "Spike fans" : type;
}

/** One line per zone or spike, for a text summary ("10mm C .15 flat Classic Brown"). */
export function formatLashZone(z: LashSet): string {
  const parts = [z.length != null ? `${z.length}mm` : null, z.curl, z.thickness != null ? `${formatLashThickness(z.thickness)}${z.flat ? " flat" : ""}` : z.flat ? "flat" : null, z.type ?? null, z.color ?? null].filter(Boolean);
  return parts.length ? parts.join(" ") : "—";
}

/** The type every zone shares, for "3D volume throughout"; null when zones differ or none is set. */
export function sharedLashType(zones: LashZone[]): string | null {
  const first = zones[0]?.type ?? null;
  return first && zones.every((z) => (z.type ?? null) === first) ? first : null;
}

/** Whether every zone (and spike) is flat, for "Flat lashes throughout" under the diagram. */
export function allLashFlat(zones: LashZone[]): boolean {
  return zones.length > 0 && zones.every((z) => z.flat && (!z.spike || z.spike.flat));
}

/** Maps saved when Flat was a type read as Classic + flat. Safe to run on any saved zones. */
export function normalizeLashZones(zones: LashZone[]): LashZone[] {
  const fix = <T extends LashSet>(z: T): T => (z.type === "Flat" ? { ...z, type: "Classic", flat: true } : z);
  return zones.map((z) => ({ ...fix(z), spike: z.spike ? fix(z.spike) : z.spike }));
}

/**
 * Where colours other than black are used, for a line under the diagram: "Brown throughout", or "Blue: zones 6, 7 · Purple: spike 5–6".
 * Null when everything is black.
 */
export function lashColorSummary(zones: LashZone[]): string | null {
  const where = new Map<string, string[]>();
  const add = (color: string | null | undefined, at: string) => { if (color) where.set(color, [...(where.get(color) ?? []), at]); };
  zones.forEach((z, i) => {
    add(z.color, `zone ${i + 1}`);
    if (z.spike) add(z.spike.color, `spike ${i + 1}–${i + 2}`);
  });
  if (!where.size) return null;
  const all = zones.length + zones.filter((z) => z.spike).length;
  const [only] = [...where.entries()];
  if (where.size === 1 && only && only[1].length === all) return `${only[0]} throughout`;
  return [...where.entries()]
    .map(([color, at]) => {
      const zs = at.filter((a) => a.startsWith("zone")).map((a) => a.slice(5));
      const ss = at.filter((a) => a.startsWith("spike"));
      return `${color}: ${[zs.length ? `zone${zs.length > 1 ? "s" : ""} ${zs.join(", ")}` : null, ...ss].filter(Boolean).join(", ")}`;
    })
    .join(" · ");
}

export class LashMapError extends Error {}

const isBlank = (z: LashSet) => z.length == null && z.curl == null && z.thickness == null && (z.type ?? null) == null && (z.color ?? null) == null && !z.flat;

function parseSet(o: Record<string, unknown>, label: string): LashSet {
  const length = o.length == null || o.length === "" ? null : Number(o.length);
  if (length != null && (!Number.isFinite(length) || length < LASH_LENGTH_MIN || length > LASH_LENGTH_MAX || Math.round(length * 2) !== length * 2)) {
    throw new LashMapError(`${label}: length must be ${LASH_LENGTH_MIN}–${LASH_LENGTH_MAX} mm in half-millimetre steps.`);
  }
  const curl = o.curl == null || o.curl === "" ? null : String(o.curl).trim().toUpperCase();
  if (curl != null && !/^[A-Z]{1,2}\+?$/.test(curl)) throw new LashMapError(`${label}: curl should be like C, CC, D or L+.`);
  const thickness = o.thickness == null || o.thickness === "" ? null : Number(o.thickness);
  if (thickness != null && (!Number.isFinite(thickness) || thickness < LASH_THICKNESS_MIN - 1e-9 || thickness > LASH_THICKNESS_MAX + 1e-9)) {
    throw new LashMapError(`${label}: thickness must be ${LASH_THICKNESS_MIN}–${LASH_THICKNESS_MAX} mm.`);
  }
  let type = o.type == null || o.type === "" ? null : String(o.type);
  let flat = o.flat === true || o.flat === "true";
  if (type === "Flat") [type, flat] = ["Classic", true]; // from before flat was its own setting
  if (type != null && !LASH_TYPES.includes(type)) throw new LashMapError(`${label}: type should be Classic, a volume fan like 3D, a premade fan like YY or 3D W, or a hybrid with one of those.`);
  let color = o.color == null ? null : String(o.color).trim().replace(/\s+/g, " ");
  if (!color || /^black$/i.test(color)) color = null;
  else if (!/^[A-Za-z][A-Za-z -]{0,19}$/.test(color)) throw new LashMapError(`${label}: colour should be a short name like Brown or Blue.`);
  else color = color.charAt(0).toUpperCase() + color.slice(1);
  return { length, curl, thickness: thickness == null ? null : Math.round(thickness * 1000) / 1000, flat, type, color };
}

/**
 * Validate zones coming from a form (JSON). Throws LashMapError with a message a person can act on. `eye` ("Left eye", "Right eye") prefixes
 * the messages when the two eyes are mapped separately.
 */
export function parseLashZones(raw: unknown, eye?: string): LashZone[] {
  const at = (label: string) => (eye ? `${eye}, ${label.charAt(0).toLowerCase()}${label.slice(1)}` : label);
  if (!Array.isArray(raw) || !(LASH_ZONE_COUNTS as readonly number[]).includes(raw.length)) throw new LashMapError(`${eye ? `${eye}: a` : "A"} lash map has 6 or 7 zones.`);
  const zones = raw.map((z, i): LashZone => {
    const o = (z ?? {}) as Record<string, unknown>;
    const set = parseSet(o, at(`Zone ${i + 1}`));
    let spike: LashSet | null = null;
    // The last zone has no divider after it, so a spike there is dropped rather than refused (the zone count may just have changed).
    if (i < raw.length - 1 && o.spike && typeof o.spike === "object") {
      const label = at(`Spike between zones ${i + 1} and ${i + 2}`);
      spike = parseSet(o.spike as Record<string, unknown>, label);
      if (spike.length == null) throw new LashMapError(`${label}: give it a length, or remove it.`);
    }
    return { ...set, spike };
  });
  if (zones.every((z) => isBlank(z) && !z.spike)) throw new LashMapError(eye ? `${eye}: fill in at least one zone.` : "Fill in at least one zone.");
  return zones;
}
