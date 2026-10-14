/**
 * Which Stripe subscription items a business should have, from the price book and what it uses, and what to
 * change to get there. Pure (no Stripe import) so it is unit tested; server/billing.ts applies the result.
 * The text number item is managed separately (attachNumberItem / detachNumberItem) and the metered text-usage
 * item is fixed at checkout, so neither appears here.
 */
import type { PriceBook } from "@angelic/core/platform-pricing";

export type ManagedKind = "base" | "location" | "staff";

export const KEY_PREFIX: Record<ManagedKind, string> = {
  base: "angelic_base_monthly_",
  location: "angelic_location_monthly_",
  staff: "angelic_staff_monthly_",
};

export interface DesiredItem {
  kind: ManagedKind;
  lookupKey: string;
  cents: number;
  quantity: number;
}

export interface ExistingItem {
  id: string;
  lookupKey: string | null;
  quantity: number;
}

export function priceKey(kind: ManagedKind, cents: number): string {
  return `${KEY_PREFIX[kind]}${cents}`;
}

export function kindOf(lookupKey: string | null): ManagedKind | null {
  if (!lookupKey) return null;
  for (const k of Object.keys(KEY_PREFIX) as ManagedKind[]) if (lookupKey.startsWith(KEY_PREFIX[k])) return k;
  return null;
}

/** The base plan always (even at $0, so the subscription has an anchor), plus extras only when they cost something. */
export function desiredItems(book: PriceBook, usage: { locations: number; activeStaff: number }): DesiredItem[] {
  const items: DesiredItem[] = [{ kind: "base", lookupKey: priceKey("base", book.baseCents), cents: book.baseCents, quantity: 1 }];
  const extraLocations = Math.max(0, usage.locations - book.includedLocations);
  if (book.perLocationCents > 0 && extraLocations > 0) items.push({ kind: "location", lookupKey: priceKey("location", book.perLocationCents), cents: book.perLocationCents, quantity: extraLocations });
  const extraStaff = Math.max(0, usage.activeStaff - book.includedStaff);
  if (book.perStaffCents > 0 && extraStaff > 0) items.push({ kind: "staff", lookupKey: priceKey("staff", book.perStaffCents), cents: book.perStaffCents, quantity: extraStaff });
  return items;
}

export interface Plan {
  create: DesiredItem[];
  /** Change an existing item's quantity and/or switch it to a new price (the price book changed). */
  update: { id: string; desired: DesiredItem; quantityChanged: boolean; priceChanged: boolean }[];
  remove: string[];
}

export function planChanges(desired: DesiredItem[], existing: ExistingItem[]): Plan {
  const plan: Plan = { create: [], update: [], remove: [] };
  const managed = existing.filter((e) => kindOf(e.lookupKey) !== null);
  const used = new Set<string>();
  for (const d of desired) {
    const match = managed.find((e) => kindOf(e.lookupKey) === d.kind && !used.has(e.id));
    if (!match) {
      plan.create.push(d);
      continue;
    }
    used.add(match.id);
    const quantityChanged = match.quantity !== d.quantity;
    const priceChanged = match.lookupKey !== d.lookupKey;
    if (quantityChanged || priceChanged) plan.update.push({ id: match.id, desired: d, quantityChanged, priceChanged });
  }
  for (const e of managed) if (!used.has(e.id)) plan.remove.push(e.id);
  return plan;
}

/**
 * Whether to pause or resume invoice collection for a suspended / reactivated business. We only resume a pause
 * we made ourselves (marked in the subscription's metadata), never one someone set in the Stripe dashboard.
 */
export function pauseAction(opts: { suspended: boolean; paused: boolean; pausedBySuspend: boolean }): "pause" | "resume" | null {
  if (opts.suspended) return opts.paused ? null : "pause";
  return opts.paused && opts.pausedBySuspend ? "resume" : null;
}

export const SUSPEND_PAUSE_MARKER = "paused_by_suspend";
