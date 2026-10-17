/**
 * Lash maps: how a stylist sets a client's lash extensions, zone by zone from the inner corner to the outer corner. One map applies to
 * both eyes (mirrored); anything asymmetric goes in the map's notes.
 */

export const LASH_CURLS = ["B", "C", "CC", "D", "DD", "J", "L", "L+", "M", "U"] as const;
export const LASH_THICKNESS_PRESETS = [0.03, 0.05, 0.07, 0.1, 0.12, 0.15, 0.18, 0.2] as const;
export const LASH_LENGTH_MIN = 4;
export const LASH_LENGTH_MAX = 20;
export const LASH_THICKNESS_MIN = 0.03;
export const LASH_THICKNESS_MAX = 0.2;
export const LASH_ZONE_COUNTS = [6, 7] as const;

export interface LashZone {
  /** Millimetres, in half-millimetre steps. Null while the zone is still blank. */
  length: number | null;
  curl: string | null;
  /** Millimetres. */
  thickness: number | null;
}

export const emptyLashZone = (): LashZone => ({ length: null, curl: null, thickness: null });

/** A gentle cat-eye starting point so a new map isn't a wall of blanks. */
export function starterLashZones(count: number): LashZone[] {
  const lengths = count === 7 ? [8, 9, 10, 11, 12, 12, 11] : [8, 9, 10, 11, 12, 11];
  return lengths.map((length) => ({ length, curl: "C", thickness: 0.07 }));
}

/** "0.07" → ".07": how thickness is written on lash trays. */
export function formatLashThickness(t: number): string {
  return t.toFixed(Math.abs(t * 100 - Math.round(t * 100)) < 1e-6 ? 2 : 3).replace(/^0/, "");
}

/** One line per zone, for a text summary ("10mm C .07"). */
export function formatLashZone(z: LashZone): string {
  const parts = [z.length != null ? `${z.length}mm` : null, z.curl, z.thickness != null ? formatLashThickness(z.thickness) : null].filter(Boolean);
  return parts.length ? parts.join(" ") : "—";
}

export class LashMapError extends Error {}

/** Validate zones coming from a form (JSON). Throws LashMapError with a message a person can act on. */
export function parseLashZones(raw: unknown): LashZone[] {
  if (!Array.isArray(raw) || !(LASH_ZONE_COUNTS as readonly number[]).includes(raw.length)) throw new LashMapError("A lash map has 6 or 7 zones.");
  const zones = raw.map((z, i): LashZone => {
    const n = i + 1;
    const o = (z ?? {}) as Record<string, unknown>;
    const length = o.length == null || o.length === "" ? null : Number(o.length);
    if (length != null && (!Number.isFinite(length) || length < LASH_LENGTH_MIN || length > LASH_LENGTH_MAX || Math.round(length * 2) !== length * 2)) {
      throw new LashMapError(`Zone ${n}: length must be ${LASH_LENGTH_MIN}–${LASH_LENGTH_MAX} mm in half-millimetre steps.`);
    }
    const curl = o.curl == null || o.curl === "" ? null : String(o.curl).trim().toUpperCase();
    if (curl != null && !/^[A-Z]{1,2}\+?$/.test(curl)) throw new LashMapError(`Zone ${n}: curl should be like C, CC, D or L+.`);
    const thickness = o.thickness == null || o.thickness === "" ? null : Number(o.thickness);
    if (thickness != null && (!Number.isFinite(thickness) || thickness < LASH_THICKNESS_MIN - 1e-9 || thickness > LASH_THICKNESS_MAX + 1e-9)) {
      throw new LashMapError(`Zone ${n}: thickness must be ${LASH_THICKNESS_MIN}–${LASH_THICKNESS_MAX} mm.`);
    }
    return { length, curl, thickness: thickness == null ? null : Math.round(thickness * 1000) / 1000 };
  });
  if (zones.every((z) => z.length == null && z.curl == null && z.thickness == null)) throw new LashMapError("Fill in at least one zone.");
  return zones;
}
