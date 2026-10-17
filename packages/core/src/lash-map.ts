/**
 * Lash maps: how a stylist sets a client's lash extensions, zone by zone from the inner corner to the outer corner. One map applies to
 * both eyes (mirrored); anything asymmetric goes in the map's notes. A zone can also carry a spike: longer lashes on the divider after
 * it (wispy and spiky styles), written on the line between two zones as printed lash maps do.
 */

export const LASH_CURLS = ["B", "C", "CC", "D", "DD", "J", "L", "L+", "M", "U"] as const;
export const LASH_THICKNESS_PRESETS = [0.03, 0.05, 0.07, 0.1, 0.12, 0.15, 0.18, 0.2] as const;
/** Classic (one lash per natural lash), hybrid, or a volume fan of n lashes. */
export const LASH_TYPES = ["Classic", "Hybrid", "2D", "3D", "4D", "5D", "6D", "8D", "10D"] as const;
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
  /** Millimetres. */
  thickness: number | null;
  /** One of LASH_TYPES. Absent on maps saved before types existed. */
  type?: string | null;
}

export interface LashZone extends LashSet {
  /** Spike on the divider between this zone and the next (never on the last zone). */
  spike?: LashSet | null;
}

export const emptyLashZone = (): LashZone => ({ length: null, curl: null, thickness: null, type: null, spike: null });

/** A gentle cat-eye starting point so a new map isn't a wall of blanks. */
export function starterLashZones(count: number): LashZone[] {
  const lengths = count === 7 ? [8, 9, 10, 11, 12, 12, 11] : [8, 9, 10, 11, 12, 11];
  return lengths.map((length) => ({ length, curl: "C", thickness: 0.07, type: null, spike: null }));
}

/** A new spike on the divider after zone `i`: a little longer than its neighbours, otherwise like the zone after it. */
export function newLashSpike(zones: LashZone[], i: number): LashSet {
  const a = zones[i];
  const b = zones[i + 1] ?? a;
  const base = Math.max(a?.length ?? 0, b?.length ?? 0) || 10;
  return { length: Math.min(LASH_LENGTH_MAX, base + LASH_SPIKE_EXTRA), curl: b?.curl ?? null, thickness: b?.thickness ?? null, type: b?.type ?? null };
}

/** "0.07" → ".07": how thickness is written on lash trays. */
export function formatLashThickness(t: number): string {
  return t.toFixed(Math.abs(t * 100 - Math.round(t * 100)) < 1e-6 ? 2 : 3).replace(/^0/, "");
}

/** "3D" → "3D volume"; Classic and Hybrid stay as they are. */
export function formatLashType(type: string): string {
  return /^\d+D$/.test(type) ? `${type} volume` : type;
}

/** One line per zone or spike, for a text summary ("10mm C .07 3D"). */
export function formatLashZone(z: LashSet): string {
  const parts = [z.length != null ? `${z.length}mm` : null, z.curl, z.thickness != null ? formatLashThickness(z.thickness) : null, z.type ?? null].filter(Boolean);
  return parts.length ? parts.join(" ") : "—";
}

/** The type every zone shares, for "3D volume throughout"; null when zones differ or none is set. */
export function sharedLashType(zones: LashZone[]): string | null {
  const first = zones[0]?.type ?? null;
  return first && zones.every((z) => (z.type ?? null) === first) ? first : null;
}

export class LashMapError extends Error {}

const isBlank = (z: LashSet) => z.length == null && z.curl == null && z.thickness == null && (z.type ?? null) == null;

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
  const type = o.type == null || o.type === "" ? null : String(o.type);
  if (type != null && !(LASH_TYPES as readonly string[]).includes(type)) throw new LashMapError(`${label}: type should be Classic, Hybrid or a volume fan like 3D.`);
  return { length, curl, thickness: thickness == null ? null : Math.round(thickness * 1000) / 1000, type };
}

/** Validate zones coming from a form (JSON). Throws LashMapError with a message a person can act on. */
export function parseLashZones(raw: unknown): LashZone[] {
  if (!Array.isArray(raw) || !(LASH_ZONE_COUNTS as readonly number[]).includes(raw.length)) throw new LashMapError("A lash map has 6 or 7 zones.");
  const zones = raw.map((z, i): LashZone => {
    const o = (z ?? {}) as Record<string, unknown>;
    const set = parseSet(o, `Zone ${i + 1}`);
    let spike: LashSet | null = null;
    // The last zone has no divider after it, so a spike there is dropped rather than refused (the zone count may just have changed).
    if (i < raw.length - 1 && o.spike && typeof o.spike === "object") {
      spike = parseSet(o.spike as Record<string, unknown>, `Spike between zones ${i + 1} and ${i + 2}`);
      if (spike.length == null) throw new LashMapError(`Spike between zones ${i + 1} and ${i + 2}: give it a length, or remove it.`);
    }
    return { ...set, spike };
  });
  if (zones.every((z) => isBlank(z) && !z.spike)) throw new LashMapError("Fill in at least one zone.");
  return zones;
}
