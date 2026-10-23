"use client";
import { useRef, useState } from "react";
import { Textarea } from "./ui";
import { AiButton } from "./ai-button";
import { describeServiceAction } from "@/app/app/[slug]/ai-actions";

/**
 * The service description box with "Write with AI" (empty) or "Improve with AI" (has text). The draft replaces the text in the box;
 * nothing is saved until the form is. Reads the name, category, timing and price from the surrounding form so the draft fits.
 */
export function AiDescriptionField({ slug, defaultValue }: { slug: string; defaultValue: string }) {
  const [value, setValue] = useState(defaultValue);
  const box = useRef<HTMLTextAreaElement>(null);
  const read = () => {
    const form = box.current?.form;
    const get = (n: string) => (form?.elements.namedItem(n) as HTMLInputElement | null)?.value ?? "";
    const minutes = ["durationMin", "gapMin", "finishMin"].reduce((sum, n) => sum + (Number(get(n)) || 0), 0);
    const price = Number(get("price").replace(/[^0-9.]/g, ""));
    return { name: get("name"), categoryId: get("categoryId") || null, minutes: minutes || null, priceCents: Number.isFinite(price) && price > 0 ? Math.round(price * 100) : null, current: value || null };
  };
  return (
    <div className="space-y-1">
      <Textarea ref={box} name="description" rows={4} value={value} onChange={(e) => setValue(e.target.value)} />
      <AiButton label={value.trim() ? "Improve with AI" : "Write with AI"} run={() => describeServiceAction(slug, read())} onDraft={(t) => { setValue(t); box.current?.dispatchEvent(new Event("input", { bubbles: true })); }} />
    </div>
  );
}
