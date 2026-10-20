"use client";
import { useEffect, useRef, useState } from "react";
import { Check } from "lucide-react";
import { APP_COLOR_PRESETS, appColorPreviewCss, MIN_APP_COLOR_CONTRAST, whiteContrast } from "@/lib/brand";
import { toast } from "@/components/toaster";
import { cn } from "@/lib/utils";
import { saveAppColor } from "./actions";

/**
 * App color: preset swatches and a custom picker. The whole app recolors the moment a color is picked, and the pick saves itself
 * shortly after (a drag through the custom picker saves once, where it stops). Too-light colors are shown but not saved.
 */
export function AppColorPicker({ slug, initial, brandColor }: { slug: string; initial: string; brandColor: string | null }) {
  const [color, setColor] = useState(initial.toLowerCase());
  const [saving, setSaving] = useState(false);
  const saved = useRef(initial.toLowerCase());
  const options = [...APP_COLOR_PRESETS, ...(brandColor && !APP_COLOR_PRESETS.some((p) => p.hex === brandColor.toLowerCase()) ? [{ name: "Booking page color", hex: brandColor.toLowerCase() }] : [])];
  const tooLight = whiteContrast(color) < MIN_APP_COLOR_CONTRAST;

  // Recolor the app now. On leaving the page the rule goes and the saved color (the layout's own rule) shows again.
  useEffect(() => {
    let el = document.getElementById("app-color-preview") as HTMLStyleElement | null;
    if (!el) { el = document.createElement("style"); el.id = "app-color-preview"; document.head.appendChild(el); }
    el.textContent = appColorPreviewCss(tooLight ? saved.current : color);
  }, [color, tooLight]);
  useEffect(() => () => document.getElementById("app-color-preview")?.remove(), []);

  const persist = async (hex: string, undoTo?: string) => {
    setSaving(true);
    const fd = new FormData();
    fd.set("slug", slug);
    fd.set("appColor", hex);
    const res = await saveAppColor(undefined, fd);
    setSaving(false);
    if (!res.ok) { toast({ message: res.fieldErrors?.appColor ?? res.error ?? "Couldn't save the app color", kind: "error" }); return; }
    saved.current = hex;
    if (undoTo) toast({ message: "App color saved", action: { label: "Undo", onClick: () => setColor(undoTo) } });
  };

  // Save the pick after a short pause, so dragging through the custom picker doesn't save every shade on the way.
  useEffect(() => {
    if (color === saved.current || tooLight) return;
    const before = saved.current;
    const t = setTimeout(() => void persist(color, before), 500);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [color, tooLight]);

  return (
    <div className="space-y-3">
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
      {tooLight ? <p className="text-xs text-amber-700">This color is too light for white button text, so it isn&apos;t saved. Pick a darker shade.</p> : <p className="text-xs text-stone-500" aria-live="polite">{saving ? "Saving…" : "Changes save automatically."}</p>}
    </div>
  );
}
