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
