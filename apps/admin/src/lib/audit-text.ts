import { FIELDS, money } from "./price-form";

type Values = Record<string, unknown>;

function show(kind: "money" | "count" | "percent", v: unknown): string {
  if (typeof v !== "number") return "default";
  return kind === "money" ? money(v) : kind === "percent" ? `${v / 100}%` : String(v);
}

/** "Base plan $29.00 → $19.00" for each price field a pricing change touched; empty for other actions. */
export function pricingChanges(action: string, detail: Values): string[] {
  const pick = (side: unknown): Values => {
    const s = (side ?? {}) as Values;
    return action === "pricing.business.update" ? ((s.overrides ?? {}) as Values) : s;
  };
  const before = pick(detail.before);
  const after = pick(detail.after);
  if (action !== "pricing.default.update" && action !== "pricing.business.update") return [];
  return FIELDS.filter((f) => before[f.key] !== after[f.key] && !(before[f.key] == null && after[f.key] == null)).map((f) => `${f.label} ${show(f.kind, before[f.key])} → ${show(f.kind, after[f.key])}`);
}

/** 5496 → "3d 19h", 90 → "1h 30m", 12 → "12m" (for a stat tile). */
export function waitingShort(minutes: number): string {
  if (minutes < 60) return `${minutes}m`;
  const h = Math.floor(minutes / 60);
  if (h < 24) return `${h}h${minutes % 60 ? ` ${minutes % 60}m` : ""}`;
  return `${Math.floor(h / 24)}d${h % 24 ? ` ${h % 24}h` : ""}`;
}

/** 5496 → "3 days 19 hours", 90 → "1 hour 30 min", 12 → "12 min". */
export function waiting(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  if (h < 24) return `${h} hour${h === 1 ? "" : "s"}${minutes % 60 ? ` ${minutes % 60} min` : ""}`;
  const d = Math.floor(h / 24);
  return `${d} day${d === 1 ? "" : "s"}${h % 24 ? ` ${h % 24} hour${h % 24 === 1 ? "" : "s"}` : ""}`;
}
