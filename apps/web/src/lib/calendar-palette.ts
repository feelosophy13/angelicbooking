import { buildTree, flattenTree, type AnyCategory } from "@/server/categories";

/**
 * Colours for "colour by service category" on the calendar. Categories have no colour of their own, so each gets one from this
 * palette in menu order (the same order as the Services page), which keeps a category's colour stable as long as the menu order is.
 * Twelve hues apart enough to tell at a glance; a thirteenth category wraps around.
 */
export const CATEGORY_PALETTE = ["#7c3aed", "#0ea5e9", "#10b981", "#f59e0b", "#ef4444", "#ec4899", "#14b8a6", "#f97316", "#6366f1", "#84cc16", "#06b6d4", "#a855f7"];
/** Services without a category. */
export const UNCATEGORIZED_COLOR = "#78716c";

/** Category id → colour, in menu order (a sub-category gets its own colour, in the flattened tree order). */
export function categoryColors(categories: AnyCategory[]): Map<string, string> {
  const ordered = flattenTree(buildTree(categories));
  return new Map(ordered.map((c, i) => [c.id, CATEGORY_PALETTE[i % CATEGORY_PALETTE.length]!]));
}
