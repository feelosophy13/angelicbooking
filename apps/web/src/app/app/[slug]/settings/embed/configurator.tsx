"use client";
import { useMemo, useState } from "react";
import { Field, Input, Select } from "@/components/ui";

type Opt = { id: string; name: string };

/** Builds the embed snippet from a few choices and shows a live preview. */
export function EmbedConfigurator({ slug, appUrl, brand, services, staff, locations }: { slug: string; appUrl: string; brand: string; services: Opt[]; staff: Opt[]; locations: Opt[] }) {
  const [mode, setMode] = useState<"inline" | "popup">("inline");
  const [service, setService] = useState("");
  const [person, setPerson] = useState("");
  const [location, setLocation] = useState("");
  const [label, setLabel] = useState("Book now");
  const [color, setColor] = useState(brand);
  const [copied, setCopied] = useState(false);

  const snippet = useMemo(() => {
    const attrs = [`src="${appUrl}/embed.js"`, `data-angelic="${slug}"`];
    if (mode === "popup") attrs.push(`data-mode="popup"`, `data-label="${label.replace(/"/g, "&quot;")}"`, `data-color="${color}"`);
    if (service) attrs.push(`data-service="${service}"`);
    if (person) attrs.push(`data-staff="${person}"`);
    if (location) attrs.push(`data-location="${location}"`);
    return `<script ${attrs.join(" ")} async></script>`;
  }, [appUrl, slug, mode, label, color, service, person, location]);

  const previewUrl = useMemo(() => {
    const p = new URLSearchParams();
    if (service) p.set("service", service);
    if (person) p.set("staff", person);
    if (location) p.set("location", location);
    return `${appUrl}/embed/${slug}${p.toString() ? `?${p}` : ""}`;
  }, [appUrl, slug, service, person, location]);

  return (
    <div className="grid gap-6 lg:grid-cols-[22rem_1fr]">
      <div className="space-y-3">
        <Field label="How it appears">
          <Select value={mode} onChange={(e) => setMode(e.target.value as "inline" | "popup")}>
            <option value="inline">Inline: the booking steps sit on the page</option>
            <option value="popup">Button: opens the booking steps in a pop-up</option>
          </Select>
        </Field>
        {mode === "popup" ? (
          <div className="grid grid-cols-[1fr_5rem] gap-2">
            <Field label="Button text"><Input value={label} onChange={(e) => setLabel(e.target.value)} /></Field>
            <Field label="Colour"><Input type="color" value={color} onChange={(e) => setColor(e.target.value)} className="h-10 p-1" /></Field>
          </div>
        ) : null}
        <Field label="Start at a service (optional)">
          <Select value={service} onChange={(e) => setService(e.target.value)}><option value="">Let the client choose</option>{services.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select>
        </Field>
        <Field label="With a provider (optional)">
          <Select value={person} onChange={(e) => setPerson(e.target.value)}><option value="">Any provider</option>{staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select>
        </Field>
        {locations.length > 1 ? (
          <Field label="Location (optional)">
            <Select value={location} onChange={(e) => setLocation(e.target.value)}><option value="">Client picks</option>{locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</Select>
          </Field>
        ) : null}
        <div>
          <p className="mb-1 text-sm font-medium text-stone-700">Paste this where you want it on your site</p>
          <textarea readOnly rows={4} value={snippet} className="w-full rounded-lg border border-stone-300 bg-stone-50 p-2 font-mono text-[11px]" onFocus={(e) => e.currentTarget.select()} />
          <button
            type="button"
            onClick={async () => {
              await navigator.clipboard.writeText(snippet).catch(() => {});
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            }}
            className="mt-1 rounded-lg border border-stone-300 bg-white px-3 py-1.5 text-sm hover:bg-stone-50"
          >
            {copied ? "Copied" : "Copy snippet"}
          </button>
          <p className="mt-2 text-xs text-stone-500">Works on Squarespace, Wix, WordPress, Shopify, Webflow, GoDaddy and plain HTML: add a “code” or “embed HTML” block and paste. Make as many as you like with different presets, e.g. one per service page.</p>
        </div>
      </div>
      <div>
        <p className="mb-1 text-sm font-medium text-stone-700">Preview</p>
        <div className="overflow-hidden rounded-xl border border-stone-200 bg-stone-100 p-3">
          {mode === "popup" ? (
            <div className="rounded-lg bg-white p-6 text-center text-sm text-stone-500">
              <span className="inline-block rounded-[10px] px-[22px] py-3 text-[15px] font-semibold text-white" style={{ background: color }}>{label || "Book now"}</span>
              <p className="mt-3">Clicking opens the booking steps in a pop-up over your page.</p>
            </div>
          ) : (
            <iframe key={previewUrl} src={previewUrl} title="Booking preview" className="h-[560px] w-full rounded-lg border-0 bg-white" />
          )}
        </div>
      </div>
    </div>
  );
}
