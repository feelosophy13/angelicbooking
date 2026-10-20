"use client";
import { useState } from "react";
import { Check } from "lucide-react";
import { APP_COLOR_PRESETS, appColorVars, MIN_APP_COLOR_CONTRAST, whiteContrast } from "@/lib/brand";
import { cn } from "@/lib/utils";

/** App color: preset swatches, a custom picker, and a small preview of buttons, links and a highlighted row in that color. */
export function AppColorPicker({ initial, brandColor }: { initial: string; brandColor: string | null }) {
  const [color, setColor] = useState(initial.toLowerCase());
  const options = [...APP_COLOR_PRESETS, ...(brandColor && !APP_COLOR_PRESETS.some((p) => p.hex === brandColor.toLowerCase()) ? [{ name: "Booking page color", hex: brandColor.toLowerCase() }] : [])];
  const tooLight = whiteContrast(color) < MIN_APP_COLOR_CONTRAST;
  return (
    <div className="space-y-4">
      <input type="hidden" name="appColor" value={color} />
      <div className="flex flex-wrap items-center gap-2" role="radiogroup" aria-label="App color">
        {options.map((o) => (
          <button key={o.hex} type="button" role="radio" aria-checked={color === o.hex} aria-label={o.name} title={o.name} onClick={() => setColor(o.hex)} className={cn("flex h-9 w-9 items-center justify-center rounded-full ring-offset-2 transition", color === o.hex ? "ring-2 ring-stone-400" : "hover:ring-2 hover:ring-stone-200")} style={{ backgroundColor: o.hex }}>
            {color === o.hex ? <Check className="h-4 w-4 text-white" /> : null}
          </button>
        ))}
        <label className="ml-1 flex items-center gap-2 text-sm text-stone-600">
          <input type="color" value={color} onChange={(e) => setColor(e.target.value.toLowerCase())} className="h-9 w-12 cursor-pointer rounded-md border border-stone-300 bg-white p-1" aria-label="Custom color" />
          Custom
        </label>
      </div>
      {tooLight ? <p className="text-xs text-amber-700">This color is too light for white button text. Pick a darker shade.</p> : null}
      <div style={appColorVars(color) as React.CSSProperties} className="flex flex-wrap items-center gap-3 rounded-lg border border-stone-200 bg-white p-3 text-sm" aria-hidden>
        <span className="rounded-lg bg-brand-600 px-3 py-1.5 font-medium text-white shadow-sm">Save</span>
        <span className="font-medium text-brand-700 underline">A link</span>
        <span className="rounded-md bg-brand-50 px-2 py-1 font-medium text-brand-700">Selected</span>
        <span className="rounded-full bg-brand-100 px-2 py-0.5 text-xs font-medium text-brand-800">Badge</span>
      </div>
    </div>
  );
}
