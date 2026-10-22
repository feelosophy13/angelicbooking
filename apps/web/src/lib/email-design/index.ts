/**
 * Email designs: the blocks an owner lays out in the designer (Marketing → Email designs, Settings → Email designs), the merge fields
 * they can drop in, and the renderer that turns a design into email-client-safe HTML (tables and inline styles; one small media query
 * for phones, which Gmail and Apple Mail honor and Outlook ignores harmlessly). Pure, so the designer's live preview in the browser and
 * the server that sends the email render exactly the same thing.
 */

export type Align = "left" | "center" | "right";

export type EmailImage = { url: string; alt: string; href?: string };

export type EmailBlock =
  | { id: string; type: "heading"; text: string; align?: Align }
  /** Text with light formatting: **bold**, *italic*, [label](https://…) and line breaks. */
  | { id: string; type: "text"; text: string; align?: Align }
  | { id: string; type: "image"; image: EmailImage }
  /** Two pictures side by side (stacked on a phone). */
  | { id: string; type: "images"; images: [EmailImage, EmailImage] }
  | { id: string; type: "button"; label: string; url: string; align?: Align }
  | { id: string; type: "divider" }
  | { id: string; type: "spacer"; size: number }
  /** Small grey closing lines (social links, a sign-off). The legal footer (address, unsubscribe) is added under it regardless. */
  | { id: string; type: "footer"; text: string }
  /** An automatic email's own content (the visit details and manage link, the receipt, the rating stars). Required there; never in a saved design. */
  | { id: string; type: "core" };

export type BlockType = EmailBlock["type"];

export interface EmailDesign {
  subject: string;
  /** The grey line inboxes show after the subject. */
  preheader: string;
  blocks: EmailBlock[];
}

// ---------------------------------------------------------------------------
// Merge fields
// ---------------------------------------------------------------------------

/** Where a field has a value: every email, appointment emails, marketing emails, or one kind of message. */
export type FieldScope = "all" | "appointment" | "marketing" | "review" | "loyalty";

export const MERGE_FIELDS: { key: string; label: string; sample: string; scope: FieldScope }[] = [
  { key: "first_name", label: "Client first name", sample: "Maria", scope: "all" },
  { key: "last_name", label: "Client last name", sample: "Lopez", scope: "all" },
  { key: "business", label: "Business name", sample: "Angelic Beauty", scope: "all" },
  { key: "business_phone", label: "Business phone", sample: "(703) 555-0142", scope: "all" },
  { key: "business_address", label: "Business address", sample: "123 Main St, Fairfax, VA 22030", scope: "all" },
  { key: "booking_url", label: "Booking link", sample: "https://angelicbooking.com/book/angelic", scope: "all" },
  { key: "service", label: "Service", sample: "Classic Lash Full Set", scope: "appointment" },
  { key: "staff", label: "Staff member", sample: "Ava", scope: "appointment" },
  { key: "date", label: "Appointment date", sample: "Friday, October 24", scope: "appointment" },
  { key: "time", label: "Appointment time", sample: "2:30 PM", scope: "appointment" },
  { key: "when", label: "Date and time", sample: "Friday, October 24 at 2:30 PM", scope: "appointment" },
  { key: "manage_url", label: "Manage link", sample: "https://angelicbooking.com/manage/sample", scope: "appointment" },
  { key: "forms_url", label: "Forms link", sample: "https://angelicbooking.com/manage/sample/forms", scope: "appointment" },
  { key: "deposit", label: "Deposit paid", sample: "$25.00", scope: "appointment" },
  { key: "review_url", label: "Review link", sample: "https://angelicbooking.com/review/sample", scope: "review" },
  { key: "points", label: "Loyalty points", sample: "120", scope: "loyalty" },
  { key: "unsubscribe_url", label: "Unsubscribe link", sample: "https://angelicbooking.com/unsubscribe/sample", scope: "marketing" },
];

export const MERGE_KEYS = new Set(MERGE_FIELDS.map((f) => f.key));

export type MergeVars = Record<string, string | number | null | undefined>;

export const SAMPLE_VARS: Record<string, string> = Object.fromEntries(MERGE_FIELDS.map((f) => [f.key, f.sample]));

/** Fill {fields}: a known field with no value becomes empty, an unknown {word} is left as typed (so a typo shows in the preview). */
export function fillFields(text: string, vars: MergeVars, escapeValue: (s: string) => string = (s) => s): string {
  return text.replace(/\{(\w+)\}/g, (m, k: string) => {
    const v = vars[k];
    if (v == null || v === "") return MERGE_KEYS.has(k) || k in vars ? "" : m;
    return escapeValue(String(v));
  });
}

/** Field keys a design uses that are not known anywhere (shown under the editor as a warning). */
export function unknownFields(design: Pick<EmailDesign, "subject" | "preheader" | "blocks">): string[] {
  const out = new Set<string>();
  const scan = (s: string | undefined) => { for (const m of (s ?? "").matchAll(/\{(\w+)\}/g)) if (!MERGE_KEYS.has(m[1]!)) out.add(m[1]!); };
  scan(design.subject);
  scan(design.preheader);
  for (const b of design.blocks) {
    if (b.type === "heading" || b.type === "text" || b.type === "footer") scan(b.text);
    if (b.type === "button") { scan(b.label); scan(b.url); }
    if (b.type === "image") scan(b.image.href);
    if (b.type === "images") for (const i of b.images) scan(i.href);
  }
  return [...out];
}

// ---------------------------------------------------------------------------
// Validation: what the designer posts is untrusted JSON
// ---------------------------------------------------------------------------

export const MAX_BLOCKS = 40;
const str = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : "");
const align = (v: unknown): Align | undefined => (v === "left" || v === "center" || v === "right" ? v : undefined);
const blockId = (v: unknown) => (typeof v === "string" && /^[\w-]{1,40}$/.test(v) ? v : Math.random().toString(36).slice(2, 10));
const image = (v: unknown): EmailImage => {
  const o = (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
  const href = str(o.href, 500).trim();
  return { url: str(o.url, 1000).trim(), alt: str(o.alt, 200), ...(href ? { href } : {}) };
};

/** Untrusted blocks → clean blocks: unknown types dropped, text capped, at most one core block (and only when `core` is allowed). */
export function normalizeBlocks(raw: unknown, opts: { core: boolean }): EmailBlock[] {
  if (!Array.isArray(raw)) return [];
  const out: EmailBlock[] = [];
  let hasCore = false;
  for (const r of raw.slice(0, MAX_BLOCKS)) {
    if (!r || typeof r !== "object") continue;
    const o = r as Record<string, unknown>;
    const id = blockId(o.id);
    switch (o.type) {
      case "heading": out.push({ id, type: "heading", text: str(o.text, 300), align: align(o.align) }); break;
      case "text": out.push({ id, type: "text", text: str(o.text, 5000), align: align(o.align) }); break;
      case "footer": out.push({ id, type: "footer", text: str(o.text, 1000) }); break;
      case "image": out.push({ id, type: "image", image: image(o.image) }); break;
      case "images": {
        const list = Array.isArray(o.images) ? o.images : [];
        out.push({ id, type: "images", images: [image(list[0]), image(list[1])] });
        break;
      }
      case "button": out.push({ id, type: "button", label: str(o.label, 80), url: str(o.url, 500).trim(), align: align(o.align) }); break;
      case "divider": out.push({ id, type: "divider" }); break;
      case "spacer": out.push({ id, type: "spacer", size: Math.min(80, Math.max(8, Math.round(Number(o.size) || 24))) }); break;
      case "core":
        if (opts.core && !hasCore) { out.push({ id, type: "core" }); hasCore = true; }
        break;
    }
  }
  // An automatic email always keeps its own content: put it back if the posted design lost it.
  if (opts.core && !hasCore) out.push({ id: "core", type: "core" });
  return out;
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

export interface EmailBrand {
  name: string;
  logoUrl?: string | null;
  color?: string | null;
  phone?: string | null;
  address?: string | null;
}

export interface RenderOptions {
  brand: EmailBrand;
  vars: MergeVars;
  /** HTML of the automatic email's own content, for the core block. */
  core?: string;
  /** Marketing emails: the unsubscribe link and the postal address, both always shown. */
  marketing?: { unsubscribeUrl: string; address: string } | null;
  /** The "Sent by Angelic Booking" line's mark (an absolute URL). */
  markUrl?: string;
}

const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif";
const INK = "#1c1917";
const MUTED = "#78716c";
const DEFAULT_COLOR = "#6d28d9";
/** Content width inside the 600px card (32px padding each side). */
const INNER = 536;

export const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const unesc = (s: string) => s.replace(/&(amp|lt|gt|quot|#39);/g, (_, e: string) => ({ amp: "&", lt: "<", gt: ">", quot: '"', "#39": "'" })[e]!);

export const brandColor = (hex: string | null | undefined) => (hex && /^#[0-9a-fA-F]{6}$/.test(hex) ? hex : DEFAULT_COLOR);

/** White or near-black, whichever reads better on this color (for the header and buttons). */
export function textOn(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  const lin = (v: number) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
  const L = 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
  return 1.05 / (L + 0.05) >= 3 ? "#ffffff" : INK;
}

/** Only web, mail and phone links survive; anything else (javascript:, data:) becomes nothing. */
export function safeUrl(url: string): string | null {
  const u = url.trim();
  if (/^https?:\/\/[^\s"<>]+$/i.test(u) || /^mailto:[^\s"<>]+$/i.test(u) || /^tel:[+\d\s().-]+$/i.test(u)) return u;
  return null;
}

/** Text with **bold**, *italic*, [label](url) and line breaks → inline HTML. Field values are inserted after formatting, so a client's name can't add markup. */
export function formatText(text: string, vars: MergeVars, linkColor: string): string {
  let html = esc(text.replace(/\r\n?/g, "\n"));
  html = html.replace(/\[([^\]\n]+)\]\(([^)\s]+)\)/g, (m, label: string, url: string) => {
    const href = safeUrl(fillFields(unesc(url), vars));
    return href ? `<a href="${esc(href)}" style="color:${linkColor};text-decoration:underline">${label}</a>` : label;
  });
  html = html.replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>").replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, "$1<em>$2</em>");
  return fillFields(html, vars, esc).replace(/\n/g, "<br>");
}

const row = (inner: string, pad = "0 0 16px") => `<tr><td style="padding:${pad}">${inner}</td></tr>`;

function imgTag(img: EmailImage, width: number, vars: MergeVars): string {
  const src = safeUrl(img.url);
  if (!src || !/^https?:/i.test(src)) return "";
  const tag = `<img src="${esc(src)}" alt="${esc(img.alt)}" width="${width}" class="ab-img" style="display:block;width:100%;max-width:${width}px;height:auto;border:0;outline:none;text-decoration:none;border-radius:8px">`;
  const href = img.href ? safeUrl(fillFields(img.href, vars)) : null;
  return href ? `<a href="${esc(href)}" style="text-decoration:none">${tag}</a>` : tag;
}

function buttonHtml(label: string, href: string, color: string, alignTo: Align): string {
  const fg = textOn(color);
  // A table cell with the color (Outlook paints that) around a padded link (everyone else makes the whole button clickable).
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" align="${alignTo}" style="margin:${alignTo === "center" ? "0 auto" : "0"}"><tr><td bgcolor="${color}" style="background:${color};border-radius:8px;mso-padding-alt:12px 22px"><a href="${esc(href)}" style="display:inline-block;padding:12px 22px;font-family:${FONT};font-size:15px;font-weight:600;line-height:20px;color:${fg};text-decoration:none;border-radius:8px">${label}</a></td></tr></table>`;
}

function blockHtml(b: EmailBlock, o: RenderOptions, color: string): string {
  const v = o.vars;
  switch (b.type) {
    case "heading":
      return b.text.trim() ? row(`<h1 style="margin:0;font-family:${FONT};font-size:24px;line-height:1.3;font-weight:700;color:${INK};text-align:${b.align ?? "left"}">${fillFields(esc(b.text), v, esc)}</h1>`) : "";
    case "text":
      return b.text.trim() ? row(`<div style="font-family:${FONT};font-size:16px;line-height:1.6;color:${INK};text-align:${b.align ?? "left"}">${formatText(b.text, v, color)}</div>`) : "";
    case "image": {
      const img = imgTag(b.image, INNER, v);
      return img ? row(img) : "";
    }
    case "images": {
      const cells = b.images.map((i) => imgTag(i, 260, v));
      if (!cells.some(Boolean)) return "";
      return row(`<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>${cells.map((c, i) => `<td class="ab-col" width="50%" valign="top" style="width:50%;padding:${i === 0 ? "0 8px 0 0" : "0 0 0 8px"}">${c}</td>`).join("")}</tr></table>`);
    }
    case "button": {
      const href = safeUrl(fillFields(b.url, v));
      const label = fillFields(esc(b.label), v, esc);
      return href && label.trim() ? row(`<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td align="${b.align ?? "left"}">${buttonHtml(label, href, color, b.align ?? "left")}</td></tr></table>`, "4px 0 20px") : "";
    }
    case "divider":
      return row(`<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td style="border-top:1px solid #e7e5e4;font-size:0;line-height:0;height:1px">&nbsp;</td></tr></table>`, "8px 0 24px");
    case "spacer":
      return `<tr><td style="height:${b.size}px;font-size:0;line-height:0">&nbsp;</td></tr>`;
    case "footer":
      return b.text.trim() ? row(`<div style="font-family:${FONT};font-size:13px;line-height:1.5;color:${MUTED};text-align:center">${formatText(b.text, v, MUTED)}</div>`) : "";
    case "core":
      // The existing message bodies use the default violet for links and buttons: they take the business's color here too.
      return o.core ? row(`<div style="font-family:${FONT};font-size:15px;line-height:1.5;color:${INK}">${o.core.replace(/#6d28d9/g, color)}</div>`) : "";
  }
}

/** A design → { subject, html }. The header carries the logo (or the name) on the brand color; the footer the business's details. */
export function renderEmail(design: EmailDesign, o: RenderOptions): { subject: string; html: string } {
  const color = brandColor(o.brand.color);
  const onBrand = textOn(color);
  const subject = fillFields(design.subject, o.vars).replace(/\s+/g, " ").trim();
  const preheader = fillFields(design.preheader, o.vars).trim();
  const logo = o.brand.logoUrl ? safeUrl(o.brand.logoUrl) : null;
  const header = logo
    ? `<img src="${esc(logo)}" alt="${esc(o.brand.name)}" height="40" style="display:block;height:40px;width:auto;max-width:200px;border:0">`
    : `<span style="font-family:${FONT};font-size:17px;font-weight:600;color:${onBrand}">${esc(o.brand.name)}</span>`;
  const body = design.blocks.map((b) => blockHtml(b, o, color)).join("");
  const details = [o.brand.name, o.marketing?.address ?? o.brand.address, o.brand.phone].filter((x): x is string => !!x?.trim());
  const legal = `<p style="margin:0;font-family:${FONT};font-size:12px;line-height:1.5;color:${MUTED};text-align:center">${details.map(esc).join(" · ")}</p>${
    o.marketing ? `<p style="margin:8px 0 0;font-family:${FONT};font-size:12px;line-height:1.5;text-align:center"><a href="${esc(o.marketing.unsubscribeUrl)}" style="color:${MUTED};text-decoration:underline">Unsubscribe from emails like this</a></p>` : ""
  }`;
  const mark = o.markUrl ? `<img src="${esc(o.markUrl)}" alt="" width="14" height="14" style="vertical-align:-2px;margin-right:4px;border-radius:3px;border:0">` : "";
  const html = `<!doctype html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="x-apple-disable-message-reformatting">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>${esc(subject)}</title>
<!--[if mso]><noscript><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml></noscript><![endif]-->
<style>
@media only screen and (max-width:620px){.ab-card{width:100%!important}.ab-pad{padding-left:20px!important;padding-right:20px!important}.ab-col{display:block!important;width:100%!important;padding:0 0 12px!important}.ab-img{width:100%!important;max-width:100%!important;height:auto!important}}
</style>
</head>
<body style="margin:0;padding:0;background:#f5f5f4;-webkit-text-size-adjust:100%">
${preheader ? `<div style="display:none;max-height:0;max-width:0;overflow:hidden;opacity:0;mso-hide:all;font-size:1px;line-height:1px;color:#f5f5f4">${esc(preheader)}${"&#847;&zwnj;&nbsp;".repeat(30)}</div>` : ""}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#f5f5f4" style="background:#f5f5f4"><tr><td align="center" style="padding:24px 12px">
<!--[if mso]><table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0"><tr><td><![endif]-->
<table role="presentation" class="ab-card" width="600" cellpadding="0" cellspacing="0" border="0" bgcolor="#ffffff" style="width:600px;max-width:600px;background:#ffffff;border:1px solid #e7e5e4;border-radius:12px">
<tr><td class="ab-pad" bgcolor="${color}" style="background:${color};padding:16px 32px;border-radius:12px 12px 0 0">${header}</td></tr>
<tr><td class="ab-pad" style="padding:28px 32px 4px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${body}</table></td></tr>
<tr><td class="ab-pad" style="padding:8px 32px 24px;border-top:1px solid #f5f5f4">${legal}</td></tr>
</table>
<!--[if mso]></td></tr></table><![endif]-->
<p style="margin:12px 0 0;font-family:${FONT};font-size:11px;line-height:1.5;color:#a8a29e;text-align:center">${mark}Sent by Angelic Booking on behalf of ${esc(o.brand.name)}.</p>
</td></tr></table>
</body>
</html>`;
  return { subject, html };
}

// ---------------------------------------------------------------------------
// Starting points
// ---------------------------------------------------------------------------

let seq = 0;
export const newBlockId = () => `b${Date.now().toString(36)}${(seq++).toString(36)}`;

/** A fresh block of a type, with sensible starting content. */
export function newBlock(type: Exclude<BlockType, "core">): EmailBlock {
  const id = newBlockId();
  switch (type) {
    case "heading": return { id, type, text: "A heading" };
    case "text": return { id, type, text: "" };
    case "image": return { id, type, image: { url: "", alt: "" } };
    case "images": return { id, type, images: [{ url: "", alt: "" }, { url: "", alt: "" }] };
    case "button": return { id, type, label: "Book now", url: "{booking_url}", align: "left" };
    case "divider": return { id, type };
    case "spacer": return { id, type, size: 24 };
    case "footer": return { id, type, text: "" };
  }
}

export const BLOCK_LABELS: Record<BlockType, string> = {
  heading: "Heading",
  text: "Text",
  image: "Image",
  images: "Two images",
  button: "Button",
  divider: "Divider",
  spacer: "Space",
  footer: "Footer note",
  core: "Message details",
};

/** A new saved design for campaigns. */
export function starterDesign(): EmailDesign {
  return {
    subject: "",
    preheader: "",
    blocks: [
      { id: "h1", type: "heading", text: "Hi {first_name}," },
      { id: "t1", type: "text", text: "Write your message here. Use **bold** and *italics*, and add links like [our booking page]({booking_url})." },
      { id: "btn", type: "button", label: "Book now", url: "{booking_url}", align: "left" },
    ],
  };
}
