import { describe, expect, it } from "vitest";
import { fillFields, formatText, normalizeBlocks, renderEmail, safeUrl, textOn, unknownFields, MERGE_FIELDS, SAMPLE_VARS, type EmailBlock, type EmailDesign } from "..";
import { SYSTEM_EMAIL_KEYS, SYSTEM_EMAILS, systemStarter } from "../system";

const brand = { name: "Angelic Beauty", logoUrl: "https://cdn.example.com/logo.png", color: "#be185d", phone: "(703) 555-0142", address: "123 Main St, Fairfax, VA" };
const vars = { first_name: "Maria", business: "Angelic Beauty", booking_url: "https://angelicbooking.com/book/angelic", service: "Brow Lamination", manage_url: "https://angelicbooking.com/manage/abc" };
const design = (blocks: EmailBlock[], extra: Partial<EmailDesign> = {}): EmailDesign => ({ subject: "Hi {first_name}", preheader: "", blocks, ...extra });

describe("merge fields", () => {
  it("fills known fields, empties known ones without a value, and leaves typos as typed", () => {
    expect(fillFields("Hi {first_name}, see {service} {forms_url}{oops}", vars)).toBe("Hi Maria, see Brow Lamination {oops}");
  });
  it("escapes values when asked", () => {
    expect(fillFields("{first_name}", { first_name: "<b>Ann</b>" }, (s) => s.replace(/</g, "&lt;"))).toBe("&lt;b>Ann&lt;/b>");
  });
  it("covers every placeholder the existing emails and texts use", () => {
    const keys = MERGE_FIELDS.map((f) => f.key);
    for (const k of ["first_name", "business", "booking_url", "points", "service", "staff", "when", "manage_url", "deposit", "forms_url", "review_url", "unsubscribe_url"]) expect(keys).toContain(k);
    for (const f of MERGE_FIELDS) expect(SAMPLE_VARS[f.key]).toBeTruthy();
  });
  it("lists fields nobody knows", () => {
    expect(unknownFields(design([{ id: "t", type: "text", text: "{first_name} {frist_name}" }, { id: "b", type: "button", label: "Go", url: "{bookng_url}" }]))).toEqual(["frist_name", "bookng_url"]);
  });
});

describe("text formatting", () => {
  it("bold, italic, links and line breaks", () => {
    const html = formatText("**Big** news, *really*.\n[Book]({booking_url})", vars, "#be185d");
    expect(html).toContain("<strong>Big</strong>");
    expect(html).toContain("<em>really</em>");
    expect(html).toContain('<a href="https://angelicbooking.com/book/angelic" style="color:#be185d;text-decoration:underline">Book</a>');
    expect(html).toContain("<br>");
  });
  it("escapes what the owner typed and what a client's name holds", () => {
    expect(formatText("<script>x</script> {first_name}", { first_name: "**<img src=x>**" }, "#000")).toBe("&lt;script&gt;x&lt;/script&gt; **&lt;img src=x&gt;**");
  });
  it("drops links that are not web, mail or phone", () => {
    expect(formatText("[click](javascript:alert(1))", vars, "#000")).not.toContain("href");
    expect(safeUrl("mailto:hi@example.com")).toBe("mailto:hi@example.com");
    expect(safeUrl("tel:+1 703 555 0142")).toBe("tel:+1 703 555 0142");
    expect(safeUrl("data:text/html,hi")).toBeNull();
  });
});

describe("normalizeBlocks", () => {
  it("drops unknown blocks, caps text and clamps the spacer", () => {
    const out = normalizeBlocks([{ type: "script", html: "x" }, { id: "a", type: "text", text: "x".repeat(9000) }, { id: "s", type: "spacer", size: 500 }, null], { core: false });
    expect(out.map((b) => b.type)).toEqual(["text", "spacer"]);
    expect((out[0] as { text: string }).text).toHaveLength(5000);
    expect((out[1] as { size: number }).size).toBe(80);
  });
  it("keeps exactly one message-details block in an automatic email, and none in a saved design", () => {
    expect(normalizeBlocks([{ id: "h", type: "heading", text: "Hi" }], { core: true }).filter((b) => b.type === "core")).toHaveLength(1);
    expect(normalizeBlocks([{ type: "core" }, { type: "core" }], { core: true })).toHaveLength(1);
    expect(normalizeBlocks([{ type: "core" }], { core: false })).toHaveLength(0);
  });
  it("gives every block an id and keeps two images in a row", () => {
    const [b] = normalizeBlocks([{ id: "bad id!", type: "images", images: [{ url: "https://a/1.png", alt: "one" }] }], { core: false });
    expect(b!.id).toMatch(/^[\w-]+$/);
    expect(b?.type === "images" ? b.images : null).toEqual([{ url: "https://a/1.png", alt: "one" }, { url: "", alt: "" }]);
  });
});

describe("renderEmail", () => {
  const all: EmailBlock[] = [
    { id: "1", type: "heading", text: "Hello {first_name}", align: "center" },
    { id: "2", type: "text", text: "We have **news**." },
    { id: "3", type: "image", image: { url: "https://cdn.example.com/a.png", alt: "Lashes", href: "{booking_url}" } },
    { id: "4", type: "images", images: [{ url: "https://cdn.example.com/b.png", alt: "B" }, { url: "https://cdn.example.com/c.png", alt: "C" }] },
    { id: "5", type: "button", label: "Book {service}", url: "{booking_url}", align: "center" },
    { id: "6", type: "divider" },
    { id: "7", type: "spacer", size: 32 },
    { id: "8", type: "footer", text: "Follow us on [Instagram](https://instagram.com/angelic)" },
  ];

  it("lays everything out in tables with inline styles, at 600px with an Outlook wrapper and a phone media query", () => {
    const { html, subject } = renderEmail(design(all, { preheader: "20% off this week" }), { brand, vars });
    expect(subject).toBe("Hi Maria");
    expect(html).toMatch(/^<!doctype html>/);
    expect(html).toContain('<table role="presentation" class="ab-card" width="600"');
    expect(html).toContain("<!--[if mso]>");
    expect(html).toContain("@media only screen and (max-width:620px)");
    expect(html).toContain("20% off this week");
    expect(html).not.toMatch(/<script|<link |<div style="max-width/);
    // Layout never depends on the <style> block: every table cell that colors or pads carries its own style.
    expect(html).toContain('bgcolor="#be185d"');
  });

  it("puts the logo on the brand color and the business's details in the footer", () => {
    const { html } = renderEmail(design([]), { brand, vars });
    expect(html).toContain('<img src="https://cdn.example.com/logo.png" alt="Angelic Beauty" height="40"');
    expect(html).toContain("Angelic Beauty · 123 Main St, Fairfax, VA · (703) 555-0142");
    const noLogo = renderEmail(design([]), { brand: { ...brand, logoUrl: null }, vars }).html;
    expect(noLogo).toContain(">Angelic Beauty</span>");
    expect(noLogo).toMatch(/bgcolor="#be185d" style="background:#be185d;padding:16px 32px/);
  });

  it("renders every block kind", () => {
    const { html } = renderEmail(design(all), { brand, vars });
    expect(html).toContain(">Hello Maria</h1>");
    expect(html).toContain("<strong>news</strong>");
    expect(html).toMatch(/<a href="https:\/\/angelicbooking.com\/book\/angelic" style="text-decoration:none"><img src="https:\/\/cdn.example.com\/a.png" alt="Lashes" width="536"/);
    expect(html.match(/class="ab-col"/g)).toHaveLength(2);
    // Bulletproof button: the colored cell (Outlook) around a padded link (everyone else), text filled.
    expect(html).toMatch(/<td bgcolor="#be185d" style="background:#be185d;border-radius:8px;mso-padding-alt:12px 22px"><a href="https:\/\/angelicbooking.com\/book\/angelic"[^>]*>Book Brow Lamination<\/a>/);
    expect(html).toContain("border-top:1px solid #e7e5e4");
    expect(html).toContain("height:32px");
    expect(html).toContain('href="https://instagram.com/angelic"');
  });

  it("leaves out empty blocks and pictures without a web address", () => {
    const { html } = renderEmail(design([{ id: "1", type: "text", text: "  " }, { id: "2", type: "image", image: { url: "javascript:x", alt: "" } }, { id: "3", type: "button", label: "Go", url: "{forms_url}" }]), { brand, vars });
    expect(html).not.toContain("javascript:");
    expect(html).not.toContain(">Go</a>");
  });

  it("marketing emails always carry the postal address and the unsubscribe link", () => {
    const { html } = renderEmail(design([]), { brand: { ...brand, address: null }, vars, marketing: { unsubscribeUrl: "https://angelicbooking.com/unsubscribe/angelic/tok", address: "9 Oak Ave, Vienna, VA" } });
    expect(html).toContain("9 Oak Ave, Vienna, VA");
    expect(html).toContain('<a href="https://angelicbooking.com/unsubscribe/angelic/tok"');
    expect(html).toContain("Unsubscribe from emails like this");
  });

  it("transactional emails have no unsubscribe link", () => {
    expect(renderEmail(design([]), { brand, vars }).html).not.toContain("Unsubscribe");
  });

  it("puts an automatic email's own content where the message-details block is, in the brand color", () => {
    const core = `<p>Details</p><a href="x" style="background:#6d28d9">Manage appointment</a>`;
    const { html } = renderEmail(design([{ id: "h", type: "heading", text: "Booked!" }, { id: "c", type: "core" }]), { brand, vars, core });
    expect(html.indexOf("Booked!")).toBeLessThan(html.indexOf("<p>Details</p>"));
    expect(html).toContain("background:#be185d\">Manage appointment");
    expect(html).not.toContain("#6d28d9");
  });

  it("picks readable text on a light brand color, and falls back to violet for a bad one", () => {
    expect(textOn("#fde68a")).toBe("#1c1917");
    expect(textOn("#6d28d9")).toBe("#ffffff");
    expect(renderEmail(design([]), { brand: { ...brand, color: "red;}" }, vars }).html).toContain('bgcolor="#6d28d9"');
  });
});

describe("automatic emails", () => {
  it("each starts with its heading above its own content", () => {
    for (const k of SYSTEM_EMAIL_KEYS) {
      const d = systemStarter(k);
      expect(d.blocks.map((b) => b.type)).toEqual(["heading", "core"]);
      expect(unknownFields(d)).toEqual([]);
      expect(SYSTEM_EMAILS[k].label).toBeTruthy();
    }
  });
});
