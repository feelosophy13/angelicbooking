/**
 * Demo artwork: product "packshots" drawn as SVG (a bottle, tube, jar, brush… on a soft
 * gradient with the product name on the label), so the demo shop looks stocked without
 * shipping photos we don't own. Deterministic per name.
 */

const PALETTES: [string, string, string][] = [
  ["#fdf2f8", "#fbcfe8", "#be185d"],
  ["#f0fdfa", "#99f6e4", "#0f766e"],
  ["#fefce8", "#fde68a", "#b45309"],
  ["#eef2ff", "#c7d2fe", "#4338ca"],
  ["#fff7ed", "#fed7aa", "#c2410c"],
  ["#f5f3ff", "#ddd6fe", "#6d28d9"],
];

type Shape = "pump" | "dropper" | "tube" | "jar" | "bottle" | "brush" | "mask" | "pillow" | "box";

function shapeFor(name: string): Shape {
  const n = name.toLowerCase();
  if (/brush|wand|spoolie/.test(n)) return "brush";
  if (/serum|sealant|oil|drops/.test(n)) return "dropper";
  if (/spf|sunscreen|cleanser|wash/.test(n)) return "tube";
  if (/foam|mist|spray/.test(n)) return "pump";
  if (/toner|essence|water/.test(n)) return "bottle";
  if (/mask/.test(n)) return "mask";
  if (/pillow/.test(n)) return "pillow";
  if (/gift|box|set|kit/.test(n)) return "box";
  if (/cream|balm|jar|butter/.test(n)) return "jar";
  return "bottle";
}

function esc(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
}

/** One label line when the name is short, otherwise two lines split where the characters balance. */
function labelLines(name: string): [string, string] {
  const words = name.split(" ");
  if (name.length <= 14 || words.length < 2) return [name, ""];
  let best = 1;
  let bestGap = Infinity;
  for (let cut = 1; cut < words.length; cut++) {
    const gap = Math.abs(words.slice(0, cut).join(" ").length - words.slice(cut).join(" ").length);
    if (gap < bestGap) { bestGap = gap; best = cut; }
  }
  return [words.slice(0, best).join(" "), words.slice(best).join(" ")];
}

function body(shape: Shape, accent: string, label: [string, string]): string {
  const text = (y: number, size: number, weight = 600, color = "#1c1917") => `<text x="250" y="${y}" font-family="system-ui, -apple-system, Segoe UI, sans-serif" font-size="${size}" font-weight="${weight}" fill="${color}" text-anchor="middle">`;
  const lbl = (cx: number, cy: number, w: number, h: number, size = 15) =>
    `<rect x="${cx - w / 2}" y="${cy - h / 2}" width="${w}" height="${h}" rx="6" fill="#fff" fill-opacity="0.92"/>${text(cy - (label[1] ? 4 : -5), size)}${esc(label[0])}</text>${label[1] ? `${text(cy + 15, size - 3, 500, "#57534e")}${esc(label[1])}</text>` : ""}`;
  switch (shape) {
    case "pump":
      return `<rect x="236" y="68" width="28" height="30" rx="4" fill="#44403c"/><rect x="226" y="60" width="60" height="12" rx="6" fill="#57534e"/><rect x="243" y="94" width="14" height="26" fill="#78716c"/><rect x="195" y="116" width="110" height="230" rx="22" fill="${accent}" filter="url(#sh)"/><rect x="205" y="126" width="18" height="200" rx="9" fill="#fff" fill-opacity="0.28"/>${lbl(250, 240, 92, 64)}`;
    case "dropper":
      return `<ellipse cx="250" cy="70" rx="16" ry="18" fill="#1c1917"/><rect x="236" y="84" width="28" height="22" rx="4" fill="#44403c"/><rect x="246" y="106" width="8" height="70" fill="#d6d3d1" fill-opacity="0.9"/><rect x="196" y="112" width="108" height="226" rx="30" fill="${accent}" fill-opacity="0.85" filter="url(#sh)"/><rect x="208" y="130" width="16" height="190" rx="8" fill="#fff" fill-opacity="0.3"/>${lbl(250, 250, 90, 64)}`;
    case "tube":
      return `<rect x="226" y="62" width="48" height="26" rx="6" fill="#1c1917"/><path d="M190 100 h120 l-6 230 a24 24 0 0 1 -24 22 h-60 a24 24 0 0 1 -24 -22 z" fill="${accent}" filter="url(#sh)"/><path d="M205 110 h14 l-4 215 h-12 z" fill="#fff" fill-opacity="0.28"/>${lbl(250, 228, 96, 64)}`;
    case "jar":
      return `<rect x="178" y="118" width="144" height="40" rx="10" fill="#1c1917"/><rect x="172" y="156" width="156" height="180" rx="34" fill="${accent}" filter="url(#sh)"/><rect x="188" y="170" width="20" height="150" rx="10" fill="#fff" fill-opacity="0.26"/>${lbl(250, 250, 110, 64)}`;
    case "bottle":
      return `<rect x="230" y="56" width="40" height="34" rx="6" fill="#1c1917"/><path d="M222 90 h56 v30 q26 14 26 44 v150 a26 26 0 0 1 -26 26 h-56 a26 26 0 0 1 -26 -26 v-150 q0 -30 26 -44 z" fill="${accent}" fill-opacity="0.9" filter="url(#sh)"/><rect x="208" y="150" width="16" height="170" rx="8" fill="#fff" fill-opacity="0.3"/>${lbl(250, 240, 96, 64)}`;
    case "brush":
      return `<g transform="rotate(-28 250 200)"><rect x="236" y="90" width="28" height="210" rx="14" fill="${accent}" filter="url(#sh)"/><rect x="241" y="300" width="18" height="40" rx="6" fill="#44403c"/><g stroke="#1c1917" stroke-width="3" stroke-linecap="round">${Array.from({ length: 9 }, (_, i) => `<line x1="${232 + (i % 2) * 36}" y1="${60 + i * 10}" x2="${268 - (i % 2) * 36}" y2="${60 + i * 10}"/>`).join("")}</g></g>${lbl(250, 330, 150, 60, 16)}`;
    case "mask":
      return `<path d="M120 190 q40 -70 130 -60 q90 -10 130 60 q-10 70 -80 70 q-30 -2 -50 -24 q-20 22 -50 24 q-70 0 -80 -70 z" fill="${accent}" filter="url(#sh)"/><path d="M160 175 q30 -22 70 -12 M270 163 q40 -10 70 12" stroke="#fff" stroke-opacity="0.6" stroke-width="5" fill="none" stroke-linecap="round"/><path d="M120 190 q-70 40 -40 110 M380 190 q70 40 40 110" stroke="${accent}" stroke-width="7" fill="none" stroke-linecap="round" stroke-opacity="0.8"/>${lbl(250, 315, 160, 56, 16)}`;
    case "pillow":
      return `<rect x="110" y="120" width="280" height="150" rx="26" fill="${accent}" filter="url(#sh)"/><path d="M110 160 q140 -22 280 0 M110 200 q140 -22 280 0 M110 240 q140 -22 280 0" stroke="#fff" stroke-opacity="0.45" stroke-width="4" fill="none"/><rect x="110" y="270" width="280" height="40" rx="14" fill="${accent}" fill-opacity="0.75"/>${lbl(250, 335, 170, 56, 16)}`;
    case "box":
      return `<rect x="140" y="150" width="220" height="170" rx="12" fill="${accent}" filter="url(#sh)"/><rect x="130" y="120" width="240" height="46" rx="10" fill="${accent}" fill-opacity="0.85"/><rect x="236" y="120" width="28" height="200" fill="#fff" fill-opacity="0.75"/><rect x="130" y="134" width="240" height="18" fill="#fff" fill-opacity="0.75"/><path d="M250 118 q-40 -40 -30 -4 q30 -8 30 4 q0 -12 30 -4 q10 -36 -30 4 z" fill="#fff" fill-opacity="0.9"/>${lbl(250, 350, 170, 50, 16)}`;
  }
}

/** A 500×400 SVG packshot for a product name. `i` picks the palette so neighbours differ. */
export function productArt(name: string, i: number): string {
  const [bg0, bg1, accent] = PALETTES[i % PALETTES.length]!;
  const shape = shapeFor(name);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="500" height="400" viewBox="0 0 500 400"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${bg0}"/><stop offset="1" stop-color="${bg1}"/></linearGradient><filter id="sh" x="-20%" y="-10%" width="140%" height="130%"><feDropShadow dx="0" dy="10" stdDeviation="10" flood-color="#1c1917" flood-opacity="0.18"/></filter></defs><rect width="500" height="400" fill="url(#g)"/><ellipse cx="250" cy="352" rx="150" ry="16" fill="#1c1917" fill-opacity="0.08"/>${body(shape, accent, labelLines(name))}</svg>`;
}

/** Studio photos (the salon's own S3 bucket) that suit each demo package. */
export const PACKAGE_PHOTOS: Record<string, string> = {
  "Signature Glow & Lift (3 facials)": "facial/glow.jpg",
  "Radiant Glow & Booster (6 facials)": "facial/bio_booster.jpg",
};

export const PACKAGE_BLURBS: Record<string, string> = {
  "Signature Glow & Lift (3 facials)": "Three Glow Facials, booked whenever you like.",
  "Radiant Glow & Booster (6 facials)": "Six skin-science facials over a year, with a free booster on the last.",
};
