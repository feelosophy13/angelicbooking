import type { CSSProperties } from "react";

const DEFAULT = "#6d28d9";

function hexToRgb(hex: string): [number, number, number] | null {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  return m ? [parseInt(m[1]!, 16), parseInt(m[2]!, 16), parseInt(m[3]!, 16)] : null;
}

/** CSS variables for a business's brand colour: --brand, a darker hover, and a pale tint. */
export function brandVars(hex: string | null | undefined): CSSProperties {
  const rgb = hexToRgb(hex ?? DEFAULT) ?? hexToRgb(DEFAULT)!;
  const [r, g, b] = rgb;
  const dark = `rgb(${Math.round(r * 0.85)}, ${Math.round(g * 0.85)}, ${Math.round(b * 0.85)})`;
  return { "--brand": `rgb(${r}, ${g}, ${b})`, "--brand-dark": dark, "--brand-tint": `rgba(${r}, ${g}, ${b}, 0.1)`, "--brand-ring": `rgba(${r}, ${g}, ${b}, 0.4)` } as CSSProperties;
}

export const brandHex = (hex: string | null | undefined) => (hex && hexToRgb(hex) ? hex : DEFAULT);

/** The staff app's default primary color (brand-600 in globals.css). */
export const DEFAULT_APP_COLOR = DEFAULT;

/** Starting points offered under Settings → Business profile → App color; all keep white button text readable. */
export const APP_COLOR_PRESETS: { name: string; hex: string }[] = [
  { name: "Violet", hex: "#6d28d9" },
  { name: "Rose", hex: "#be185d" },
  { name: "Red", hex: "#b91c1c" },
  { name: "Amber", hex: "#b45309" },
  { name: "Emerald", hex: "#047857" },
  { name: "Teal", hex: "#0f766e" },
  { name: "Blue", hex: "#1d4ed8" },
  { name: "Slate", hex: "#334155" },
];

const luminance = ([r, g, b]: [number, number, number]) => {
  const c = (v: number) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * c(r) + 0.7152 * c(g) + 0.0722 * c(b);
};

/** Contrast ratio of white text on this color (1–21). Buttons are white on the primary color, so it must stay legible. */
export function whiteContrast(hex: string): number {
  const rgb = hexToRgb(hex);
  return rgb ? 1.05 / (luminance(rgb) + 0.05) : 1;
}
/** WCAG's floor for UI components and bold text; below it white button labels wash out. */
export const MIN_APP_COLOR_CONTRAST = 3;

/**
 * The --brand-50…900 values that recolor the staff app: the chosen color is brand-600 (buttons), lighter shades mix toward white
 * (tints, pale highlighted rows) and darker ones toward black (link text, which sits on white).
 */
export function appColorVars(hex: string): Record<string, string> {
  const tint = (pct: number) => `color-mix(in oklab, ${hex} ${pct}%, white)`;
  const shade = (pct: number) => `color-mix(in oklab, ${hex} ${pct}%, black)`;
  const steps: [number, string][] = [[50, tint(6)], [100, tint(12)], [200, tint(24)], [300, tint(40)], [400, tint(62)], [500, tint(84)], [600, hex], [700, shade(82)], [800, shade(66)], [900, shade(52)]];
  return Object.fromEntries(steps.map(([k, v]) => [`--brand-${k}`, v]));
}

/** The :root rule for a business's App color; null for the default violet, which globals.css already defines. */
export function appColorCss(hex: string | null | undefined): string | null {
  if (!hex || !hexToRgb(hex) || hex.toLowerCase() === DEFAULT) return null;
  return `:root{${Object.entries(appColorVars(hex)).map(([k, v]) => `${k}:${v}`).join(";")}}`;
}
