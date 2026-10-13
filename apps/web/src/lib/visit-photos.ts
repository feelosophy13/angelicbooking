/** Pure rules for before/after photos: tags, the pair a photo belongs to, and the Gallery's filters. */

export const PHASES = ["before", "after"] as const;
export type Phase = (typeof PHASES)[number];
export const isPhase = (v: unknown): v is Phase => v === "before" || v === "after";

export const MAX_TAGS = 12;
export const MAX_TAG_LENGTH = 30;

/** "Balayage, #blonde ,  BALAYAGE" -> ["balayage", "blonde"]: lower case, no hash, no duplicates, capped. */
export function parseTags(raw: string | null | undefined): string[] {
  const seen = new Set<string>();
  for (const part of String(raw ?? "").split(/[,;\n]/)) {
    const t = part.trim().replace(/^#+/, "").trim().replace(/\s+/g, " ").toLowerCase().slice(0, MAX_TAG_LENGTH).trim();
    if (t) seen.add(t);
    if (seen.size >= MAX_TAGS) break;
  }
  return [...seen];
}

/** Photos of one appointment, service and stylist are shown together as a before/after pair. */
export const pairKey = (p: { appointmentId: string; serviceId: string | null; staffId: string | null }) => `${p.appointmentId}:${p.serviceId ?? ""}:${p.staffId ?? ""}`;

export const GALLERY_PERIODS = [
  { key: "", label: "Any time", days: null },
  { key: "30", label: "Last 30 days", days: 30 },
  { key: "90", label: "Last 90 days", days: 90 },
  { key: "365", label: "Last year", days: 365 },
] as const;

export interface GalleryFilters {
  serviceId: string | null;
  staffId: string | null;
  clientId: string | null;
  locationId: string | null;
  tag: string | null;
  /** Days back from now, or null for any time. */
  periodDays: number | null;
  q: string | null;
  bothOnly: boolean;
  shareableOnly: boolean;
  page: number;
}

export type GallerySearchParams = Partial<Record<"service" | "staff" | "client" | "location" | "tag" | "period" | "q" | "both" | "share" | "page", string>>;

/** Turn the page's query string into filters, dropping ids that are not in the lists the page offered. */
export function parseGalleryFilters(sp: GallerySearchParams, valid: { serviceIds: string[]; staffIds: string[]; locationIds: string[] }): GalleryFilters {
  const pick = (v: string | undefined, ids: string[]) => (v && ids.includes(v) ? v : null);
  const period = GALLERY_PERIODS.find((p) => p.key === sp.period);
  return {
    serviceId: pick(sp.service, valid.serviceIds),
    staffId: pick(sp.staff, valid.staffIds),
    clientId: sp.client && /^[0-9a-zA-Z_-]{6,64}$/.test(sp.client) ? sp.client : null,
    locationId: pick(sp.location, valid.locationIds),
    tag: parseTags(sp.tag)[0] ?? null,
    periodDays: period?.days ?? null,
    q: sp.q?.trim().slice(0, 80) || null,
    bothOnly: sp.both === "1",
    shareableOnly: sp.share === "1",
    page: Math.max(1, Math.min(500, Number(sp.page ?? 1) || 1)),
  };
}

export const hasGalleryFilters = (f: GalleryFilters) => !!(f.serviceId || f.staffId || f.clientId || f.locationId || f.tag || f.periodDays || f.q || f.bothOnly || f.shareableOnly);

export interface PhotoRow {
  id: string;
  phase: Phase;
  fileId: string;
  thumbFileId: string | null;
  takenAt: Date;
}
export interface PhotoPair {
  key: string;
  appointmentId: string;
  clientId: string | null;
  clientName: string | null;
  serviceId: string | null;
  serviceName: string | null;
  staffId: string | null;
  staffName: string | null;
  locationId: string | null;
  /** When the earliest photo of the pair was taken. */
  takenAt: Date;
  tags: string[];
  shareOk: boolean;
  before: PhotoRow[];
  after: PhotoRow[];
}
export interface PhotoQueryRow extends PhotoRow {
  appointmentId: string;
  clientId: string | null;
  serviceId: string | null;
  staffId: string | null;
  tags: string[];
  shareOk: boolean;
  serviceName: string | null;
  staffName: string | null;
  firstName: string | null;
  lastName: string | null;
  locationId: string | null;
}

/** Fold photo rows into before/after pairs. With `order`, only those pairs are returned, in that order. */
export function buildPairs(rows: PhotoQueryRow[], order?: string[]): PhotoPair[] {
  const byKey = new Map<string, PhotoPair>();
  for (const r of rows) {
    const key = pairKey(r);
    let pair = byKey.get(key);
    if (!pair) {
      const name = `${r.firstName ?? ""} ${r.lastName ?? ""}`.trim();
      pair = { key, appointmentId: r.appointmentId, clientId: r.clientId, clientName: name || null, serviceId: r.serviceId, serviceName: r.serviceName, staffId: r.staffId, staffName: r.staffName, locationId: r.locationId, takenAt: r.takenAt, tags: r.tags, shareOk: r.shareOk, before: [], after: [] };
      byKey.set(key, pair);
    }
    if (r.takenAt < pair.takenAt) pair.takenAt = r.takenAt;
    (r.phase === "before" ? pair.before : pair.after).push({ id: r.id, phase: r.phase, fileId: r.fileId, thumbFileId: r.thumbFileId, takenAt: r.takenAt });
  }
  return order ? order.map((k) => byKey.get(k)).filter((p): p is PhotoPair => !!p) : [...byKey.values()];
}
