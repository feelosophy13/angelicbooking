"use client";
import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { ArrowDown, ArrowUp, Bold, ChevronDown, Columns2, Heading, Image as ImageIcon, Italic, Link2, Loader2, Minus, Monitor, MousePointerClick, MoveVertical, Plus, Smartphone, Trash2, Type, X, AlignLeft, LayoutList } from "lucide-react";
import { ActionForm, Field, SubmitButton } from "@/components/form";
import { Button, Input, Select, Textarea } from "@/components/ui";
import { toast } from "@/components/toaster";
import { Segmented } from "@/app/app/[slug]/sales/[saleId]/forms";
import { BLOCK_LABELS, MERGE_FIELDS, newBlock, renderEmail, unknownFields, type Align, type BlockType, type EmailBlock, type EmailBrand, type EmailImage, type FieldScope } from "@/lib/email-design";
import { sendTestEmail, uploadEmailImage } from "@/app/app/[slug]/marketing/designs/actions";
import { cn } from "@/lib/utils";

type Action = Parameters<typeof ActionForm>[0]["action"];

const ICON: Record<BlockType, typeof Type> = { heading: Heading, text: Type, image: ImageIcon, images: Columns2, button: MousePointerClick, divider: Minus, spacer: MoveVertical, footer: AlignLeft, core: LayoutList };
const ADDABLE: Exclude<BlockType, "core">[] = ["heading", "text", "image", "images", "button", "divider", "spacer", "footer"];

/** One line that says what a collapsed block holds. */
function headline(b: EmailBlock): string {
  const cut = (s: string) => (s.length > 70 ? `${s.slice(0, 70)}…` : s);
  switch (b.type) {
    case "heading": case "text": case "footer": return cut(b.text.replace(/\s+/g, " ").trim()) || "Empty";
    case "image": return b.image.url ? b.image.alt || "Picture" : "No picture yet";
    case "images": return `${b.images.filter((i) => i.url).length} of 2 pictures`;
    case "button": return `${b.label || "No label"} → ${b.url || "no link"}`;
    case "divider": return "A thin line";
    case "spacer": return `${b.size}px of space`;
    case "core": return "The message's own details (always included)";
  }
}

/**
 * The email designer: blocks on the left (one open at a time, like a workflow's steps), the email as it will arrive on the right, on a
 * desktop or a phone, rendered by the same code that sends it. Saving posts the blocks as JSON in `design`; "Send me a test" sends what
 * is on screen, saved or not.
 */
export function EmailDesigner({ slug, mode, systemKey, action, hidden, initial, brand, vars, core, coreHint, defaultSubject, scopes, address, saveLabel, aside }: {
  slug: string;
  mode: "saved" | "system";
  systemKey?: string;
  action: Action;
  hidden: Record<string, string>;
  initial: { name?: string; subject: string; preheader: string; blocks: EmailBlock[] };
  brand: EmailBrand;
  /** Sample values for the preview. */
  vars: Record<string, string>;
  /** The automatic email's own content, filled with a sample visit. */
  core?: string;
  coreHint?: string;
  /** The usual subject an automatic email keeps when the subject is left empty. */
  defaultSubject?: string;
  scopes: FieldScope[];
  /** Postal address shown in a marketing email's footer; null when the business has none yet. */
  address: string | null;
  saveLabel: string;
  /** Under the preview: delete, reset to default. */
  aside?: React.ReactNode;
}) {
  const [blocks, setBlocks] = useState<EmailBlock[]>(initial.blocks);
  const [subject, setSubject] = useState(initial.subject);
  const [preheader, setPreheader] = useState(initial.preheader);
  const [open, setOpen] = useState<string | null>(null);
  const [menu, setMenu] = useState(false);
  const fields = MERGE_FIELDS.filter((f) => scopes.includes(f.scope));
  const refs = useRef(new Map<string, HTMLInputElement | HTMLTextAreaElement>());

  const update = (id: string, patch: Partial<EmailBlock>) => setBlocks((list) => list.map((b) => (b.id === id ? ({ ...b, ...patch } as EmailBlock) : b)));
  const move = (i: number, dir: -1 | 1) => setBlocks((s) => { const j = i + dir; if (j < 0 || j >= s.length) return s; const c = [...s]; [c[i], c[j]] = [c[j]!, c[i]!]; return c; });
  /** Change one picture of a block from the latest state (an upload finishes after other edits, or alongside the other picture's). */
  const patchImage = (id: string, k: number, patch: Partial<EmailImage>) =>
    setBlocks((list) => list.map((b) => {
      if (b.id !== id) return b;
      if (b.type === "image") return { ...b, image: { ...b.image, ...patch } };
      if (b.type === "images") return { ...b, images: b.images.map((img, j) => (j === k ? { ...img, ...patch } : img)) as [EmailImage, EmailImage] };
      return b;
    }));
  const remove = (id: string) => setBlocks((s) => s.filter((b) => b.id !== id));
  const add = (type: Exclude<BlockType, "core">) => {
    const b = newBlock(type);
    setBlocks((list) => {
      const at = open ? list.findIndex((x) => x.id === open) + 1 : list.length;
      return [...list.slice(0, at), b, ...list.slice(at)];
    });
    setOpen(b.id);
    setMenu(false);
  };

  /** Put `before`/`after` around the selection of a block's text box (or `insert` at the cursor), keeping the cursor where it belongs. */
  function edit(id: string, key: "text" | "label", opts: { insert?: string; before?: string; after?: string; placeholder?: string }) {
    const el = refs.current.get(`${id}:${key}`);
    const b = blocks.find((x) => x.id === id) as Record<string, unknown> | undefined;
    if (!el || !b) return;
    const value = String(b[key] ?? "");
    const start = el.selectionStart ?? value.length;
    const end = el.selectionEnd ?? value.length;
    const chosen = value.slice(start, end) || opts.placeholder || "";
    const piece = opts.insert ?? `${opts.before ?? ""}${chosen}${opts.after ?? ""}`;
    update(id, { [key]: value.slice(0, start) + piece + value.slice(end) } as Partial<EmailBlock>);
    requestAnimationFrame(() => {
      el.focus();
      const caret = opts.insert ? start + piece.length : start + (opts.before ?? "").length + chosen.length;
      el.setSelectionRange(opts.insert ? caret : start + (opts.before ?? "").length, caret);
    });
  }

  const design = useDeferredValue({ subject, preheader, blocks });
  const rendered = useMemo(
    () =>
      renderEmail(design, {
        brand,
        vars,
        core,
        marketing: mode === "saved" ? { unsubscribeUrl: vars.unsubscribe_url ?? "https://example.com", address: address ?? "Your postal address (add it under Settings → Locations)" } : null,
      }),
    [design, brand, vars, core, mode, address],
  );
  const unknown = unknownFields(design);

  const FieldMenu = ({ id, prop }: { id: string; prop: "text" | "label" }) => (
    <Select value="" onChange={(e) => { if (e.target.value) edit(id, prop, { insert: `{${e.target.value}}` }); }} className="h-8 w-auto py-0 text-xs" aria-label="Insert a field">
      <option value="">Insert field…</option>
      {fields.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
    </Select>
  );
  const AlignPick = ({ b }: { b: Extract<EmailBlock, { align?: Align }> }) => (
    <Segmented label="Alignment" value={b.align === "center" ? "center" : "left"} onChange={(v) => update(b.id, { align: v })} options={[{ value: "left", label: "Left" }, { value: "center", label: "Center" }]} className="w-auto text-xs" />
  );
  const linkFields = fields.filter((f) => f.key.endsWith("_url"));

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <div className="min-w-0 rounded-xl border border-stone-200 bg-white p-5">
        <ActionForm action={action}>
          {Object.entries(hidden).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
          <input type="hidden" name="design" value={JSON.stringify(blocks)} />
          {mode === "saved" ? <Field label="Name (internal)" name="name" required><Input name="name" defaultValue={initial.name ?? ""} required maxLength={80} placeholder="October lash special" /></Field> : null}
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Subject" name="subject" hint={mode === "system" ? (defaultSubject ? `Leave empty to keep the usual one: “${defaultSubject}”.` : "Leave empty to keep the usual subject.") : "A campaign's own subject, when it has one, is used instead."}>
              <Input name="subject" value={subject} onChange={(e) => setSubject(e.target.value)} maxLength={150} />
            </Field>
            <Field label="Preview text (optional)" name="preheader" hint="The grey line inboxes show after the subject.">
              <Input name="preheader" value={preheader} onChange={(e) => setPreheader(e.target.value)} maxLength={150} />
            </Field>
          </div>

          <div>
            <p className="mb-2 text-sm font-medium text-stone-700">Blocks</p>
            <p className="mb-3 text-xs text-stone-500">Your logo and color sit at the top; your business details{mode === "saved" ? ", postal address and the unsubscribe link" : ""} at the bottom. Click a block to edit it.</p>
            <ol className="space-y-2">
              {blocks.map((b, i) => {
                const I = ICON[b.type];
                const isOpen = open === b.id;
                return (
                  <li key={b.id} className={cn("rounded-xl border bg-white transition", isOpen ? "border-brand-300 shadow-sm" : "border-stone-200 hover:border-stone-300")}>
                    <div className="flex items-center gap-2 px-3 py-2">
                      <button type="button" onClick={() => setOpen(isOpen ? null : b.id)} className="flex min-w-0 flex-1 items-center gap-2 text-left" aria-expanded={isOpen}>
                        <I className="h-4 w-4 shrink-0 text-stone-400" aria-hidden />
                        <span className="shrink-0 text-xs font-semibold uppercase tracking-wide text-stone-400">{BLOCK_LABELS[b.type]}</span>
                        <span className="min-w-0 truncate text-sm text-stone-800">{headline(b)}</span>
                      </button>
                      <button type="button" onClick={() => move(i, -1)} disabled={i === 0} aria-label="Move up" className="rounded p-1.5 text-stone-400 lg:pointer-fine:p-1 hover:text-stone-800 disabled:opacity-30"><ArrowUp className="h-4 w-4" /></button>
                      <button type="button" onClick={() => move(i, 1)} disabled={i === blocks.length - 1} aria-label="Move down" className="rounded p-1.5 text-stone-400 lg:pointer-fine:p-1 hover:text-stone-800 disabled:opacity-30"><ArrowDown className="h-4 w-4" /></button>
                      {b.type !== "core" ? <button type="button" onClick={() => remove(b.id)} aria-label="Remove block" className="rounded p-1.5 text-stone-400 lg:pointer-fine:p-1 hover:text-red-600"><Trash2 className="h-4 w-4" /></button> : null}
                      <button type="button" onClick={() => setOpen(isOpen ? null : b.id)} aria-label={isOpen ? "Collapse" : "Edit"} className="rounded p-1.5 text-stone-400 lg:pointer-fine:p-1 hover:text-stone-800"><ChevronDown className={cn("h-4 w-4 transition", isOpen && "rotate-180")} /></button>
                    </div>
                    {isOpen ? (
                      <div className="space-y-3 border-t border-stone-100 px-3 py-3">
                        {b.type === "heading" ? (
                          <>
                            <Input ref={(el) => { if (el) refs.current.set(`${b.id}:text`, el); }} value={b.text} onChange={(e) => update(b.id, { text: e.target.value })} maxLength={300} aria-label="Heading" />
                            <div className="flex flex-wrap items-center gap-2"><AlignPick b={b} /><FieldMenu id={b.id} prop="text" /></div>
                          </>
                        ) : null}
                        {b.type === "text" || b.type === "footer" ? (
                          <>
                            <div className="flex flex-wrap items-center gap-1">
                              <button type="button" onClick={() => edit(b.id, "text", { before: "**", after: "**", placeholder: "bold text" })} className="hit rounded p-1.5 text-stone-600 hover:bg-stone-100" aria-label="Bold" title="Bold"><Bold className="h-4 w-4" /></button>
                              <button type="button" onClick={() => edit(b.id, "text", { before: "*", after: "*", placeholder: "italic text" })} className="hit rounded p-1.5 text-stone-600 hover:bg-stone-100" aria-label="Italic" title="Italic"><Italic className="h-4 w-4" /></button>
                              <button type="button" onClick={() => edit(b.id, "text", { before: "[", after: "](https://)", placeholder: "link text" })} className="hit rounded p-1.5 text-stone-600 hover:bg-stone-100" aria-label="Link" title="Link"><Link2 className="h-4 w-4" /></button>
                              <span className="mx-1 h-5 w-px bg-stone-200" aria-hidden />
                              <FieldMenu id={b.id} prop="text" />
                              {b.type === "text" ? <AlignPick b={b} /> : null}
                            </div>
                            <Textarea ref={(el) => { if (el) refs.current.set(`${b.id}:text`, el); }} rows={b.type === "footer" ? 2 : 5} value={b.text} onChange={(e) => update(b.id, { text: e.target.value })} maxLength={b.type === "footer" ? 1000 : 5000} aria-label={BLOCK_LABELS[b.type]} placeholder={b.type === "footer" ? "Follow us on [Instagram](https://instagram.com/…)" : "Hi {first_name}, …"} />
                            <p className="text-xs text-stone-500">**bold**, *italic* and [link text](https://…). A blank line starts a new paragraph.</p>
                          </>
                        ) : null}
                        {b.type === "image" ? <ImageEditor slug={slug} image={b.image} onChange={(patch) => patchImage(b.id, 0, patch)} wide /> : null}
                        {b.type === "images" ? (
                          <div className="grid gap-4 sm:grid-cols-2">
                            {b.images.map((img, k) => <ImageEditor key={k} slug={slug} image={img} onChange={(patch) => patchImage(b.id, k, patch)} />)}
                          </div>
                        ) : null}
                        {b.type === "button" ? (
                          <>
                            <div className="grid gap-3 sm:grid-cols-2">
                              <Field label="Label"><Input ref={(el) => { if (el) refs.current.set(`${b.id}:label`, el); }} value={b.label} onChange={(e) => update(b.id, { label: e.target.value })} maxLength={80} /></Field>
                              <Field label="Goes to">
                                <Select value={linkFields.some((f) => b.url === `{${f.key}}`) ? b.url : "custom"} onChange={(e) => update(b.id, { url: e.target.value === "custom" ? "https://" : e.target.value })}>
                                  {linkFields.map((f) => <option key={f.key} value={`{${f.key}}`}>{f.label}</option>)}
                                  <option value="custom">Another web address</option>
                                </Select>
                              </Field>
                            </div>
                            {!linkFields.some((f) => b.url === `{${f.key}}`) ? <Field label="Web address"><Input value={b.url} onChange={(e) => update(b.id, { url: e.target.value })} inputMode="url" placeholder="https://" maxLength={500} /></Field> : null}
                            <AlignPick b={b} />
                          </>
                        ) : null}
                        {b.type === "spacer" ? (
                          <Segmented label="Space" value={String(b.size)} onChange={(v) => update(b.id, { size: Number(v) })} options={[{ value: "12", label: "Small" }, { value: "24", label: "Medium" }, { value: "48", label: "Large" }]} className="w-auto max-w-xs" />
                        ) : null}
                        {b.type === "divider" ? <p className="text-xs text-stone-500">A thin grey line across the email.</p> : null}
                        {b.type === "core" ? <p className="text-sm text-stone-600">{coreHint ?? "The message's own details."} It can move up or down but stays in the email, so the client always gets what they need.</p> : null}
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ol>
            <div className="relative mt-3">
              <Button type="button" variant="secondary" size="sm" onClick={() => setMenu((m) => !m)} aria-expanded={menu}><Plus className="h-4 w-4" /> Add a block{open ? " below the open one" : ""}</Button>
              {menu ? (
                <div className="mt-2 grid grid-cols-2 gap-2 rounded-xl border border-stone-200 bg-white p-2 shadow-sm sm:grid-cols-4">
                  {ADDABLE.map((t) => {
                    const I = ICON[t];
                    return <button key={t} type="button" onClick={() => add(t)} className="flex flex-col items-center gap-1 rounded-lg px-2 py-3 text-xs text-stone-700 hover:bg-stone-50"><I className="h-5 w-5 text-stone-500" />{BLOCK_LABELS[t]}</button>;
                  })}
                </div>
              ) : null}
            </div>
            {unknown.length ? <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">{unknown.map((k) => `{${k}}`).join(", ")} {unknown.length === 1 ? "isn't a field" : "aren't fields"}: {unknown.length === 1 ? "it" : "they"} will show exactly as typed. Use “Insert field” to pick one.</p> : null}
          </div>
          <SubmitButton pendingText="Saving…">{saveLabel}</SubmitButton>
        </ActionForm>
      </div>

      <div className="min-w-0 space-y-4 xl:sticky xl:top-4 xl:self-start">
        <Preview html={rendered.html} subject={rendered.subject || defaultSubject || "(no subject)"} preheader={rendered.html ? design.preheader : ""} from={brand.name} slug={slug} systemKey={systemKey} design={design} />
        {aside}
      </div>
    </div>
  );
}

/** The email in an inbox: the From / subject / preview line, then the message at desktop width (scaled to fit) or on a phone. */
function Preview({ html, subject, preheader, from, slug, systemKey, design }: { html: string; subject: string; preheader: string; from: string; slug: string; systemKey?: string; design: { subject: string; preheader: string; blocks: EmailBlock[] } }) {
  const [device, setDevice] = useState<"desktop" | "mobile">("desktop");
  const [height, setHeight] = useState(600);
  const [width, setWidth] = useState(680);
  const [sending, setSending] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const frame = useRef<HTMLIFrameElement>(null);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const frameWidth = device === "desktop" ? 680 : 375;
  const scale = device === "desktop" ? Math.min(1, width / frameWidth) : 1;
  // Links open in a new tab instead of inside the preview.
  const doc = html.replace("<head>", '<head><base target="_blank">');
  const measure = () => {
    const d = frame.current?.contentDocument;
    if (d) setHeight(Math.max(300, d.documentElement.scrollHeight));
  };
  async function test() {
    setSending(true);
    try {
      const r = await sendTestEmail({ slug, key: systemKey ?? null, ...design });
      toast({ message: r.message, kind: r.ok ? "success" : "error" });
    } finally {
      setSending(false);
    }
  }
  return (
    <div className="rounded-xl border border-stone-200 bg-white">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-stone-100 px-4 py-3">
        <Segmented label="Preview size" value={device} onChange={setDevice} options={[{ value: "desktop", label: <span className="inline-flex items-center gap-1"><Monitor className="h-4 w-4" /> Desktop</span> }, { value: "mobile", label: <span className="inline-flex items-center gap-1"><Smartphone className="h-4 w-4" /> Phone</span> }]} className="w-auto" />
        <Button type="button" variant="secondary" size="sm" onClick={test} disabled={sending}>{sending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}Send me a test</Button>
      </div>
      <div className="border-b border-stone-100 px-4 py-2 text-sm">
        <p className="truncate"><span className="font-semibold text-stone-900">{from}</span></p>
        <p className="truncate text-stone-800">{subject}{preheader ? <span className="text-stone-500"> · {preheader}</span> : null}</p>
      </div>
      <div ref={box} className="overflow-hidden bg-stone-100 p-0">
        <div className={cn("mx-auto", device === "mobile" && "my-4 overflow-hidden rounded-[28px] border-8 border-stone-800 bg-white")} style={{ width: device === "desktop" ? frameWidth * scale : frameWidth + 16, height: height * scale + (device === "mobile" ? 16 : 0) }}>
          <iframe ref={frame} title="Email preview" srcDoc={doc} onLoad={measure} sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox" className="block border-0 bg-white" style={{ width: frameWidth, height, transform: scale < 1 ? `scale(${scale})` : undefined, transformOrigin: "top left" }} />
        </div>
      </div>
    </div>
  );
}

/** A picture in a design: the picture is the control (click to pick, × to remove); it is stored the moment it is picked. */
function ImageEditor({ slug, image, onChange, wide }: { slug: string; image: EmailImage; onChange: (patch: Partial<EmailImage>) => void; wide?: boolean }) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  async function pick(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    try {
      const fd = new FormData();
      fd.set("slug", slug);
      fd.set("file", file);
      const r = await uploadEmailImage(fd);
      if (r.url) onChange({ url: r.url, ...(image.alt ? {} : { alt: file.name.replace(/\.[a-z0-9]+$/i, "").replace(/[-_]+/g, " ") }) });
      else toast({ message: r.error ?? "That picture could not be added.", kind: "error" });
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  }
  return (
    <div className="space-y-2">
      <input ref={input} type="file" accept="image/*" className="sr-only" tabIndex={-1} onChange={(e) => pick(e.target.files?.[0])} />
      <div className="relative">
        <button type="button" onClick={() => input.current?.click()} className={cn("flex w-full items-center justify-center overflow-hidden rounded-xl border border-dashed border-stone-300 bg-stone-50 text-sm text-stone-500 hover:border-stone-400", wide ? "h-40" : "h-32")} aria-label={image.url ? "Change picture" : "Add a picture"}>
          {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : image.url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={image.url} alt={image.alt} className="h-full w-full object-cover" />
          ) : <span className="flex flex-col items-center gap-1"><ImageIcon className="h-5 w-5" />Click to add a picture</span>}
        </button>
        {image.url && !busy ? <button type="button" onClick={() => onChange({ url: "" })} aria-label="Remove picture" className="absolute -right-2 -top-2 flex h-7 w-7 items-center justify-center rounded-full border border-stone-200 bg-white text-stone-600 shadow-sm hover:text-red-600"><X className="h-4 w-4" /></button> : null}
      </div>
      <Input value={image.alt} onChange={(e) => onChange({ alt: e.target.value })} placeholder="Describe the picture (for screen readers)" maxLength={200} aria-label="Picture description" />
      <Input value={image.href ?? ""} onChange={(e) => onChange({ href: e.target.value || undefined })} placeholder="Link when tapped (optional), e.g. {booking_url}" maxLength={500} aria-label="Picture link" />
    </div>
  );
}
