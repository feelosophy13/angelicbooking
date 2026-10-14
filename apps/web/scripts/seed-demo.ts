/**
 * Creates (or refreshes) a demo business with realistic fake data so the app can be
 * shown without touching a real tenant: nested service menu with images, staff on every
 * pay model, 40 clients, two months of completed visits with sales, tips and reviews,
 * upcoming bookings, products with stock, forms, packages, memberships, gift cards,
 * promo code, waitlist and automations.
 *
 * Usage (from apps/web, against whatever DATABASE_URL points at):
 *   ../../packages/db/node_modules/.bin/tsx --env-file=../../.env scripts/seed-demo.ts [--profile luxe|glow] [--reset]
 *
 * Profiles:
 *   luxe (default)  demo@angelicbooking.com  / demo-salon-2026  slug demo-salon     one studio
 *   glow            demo2@angelicbooking.com / demo-salon-2026  slug demo-twosites  two locations (Arlington, Reston)
 * --reset deletes that demo business first (never any other tenant) and rebuilds it.
 * Hosted demo (Render cron job angelic-booking-demo-refresh): DEMO_ALLOW_REMOTE=1 and DEMO_PASSWORD=<secret> are set there;
 * the demo businesses never send email or text (lib/notify skips slugs that start with "demo-").
 */
import { and, desc, eq, sql } from "drizzle-orm";
import { db, getSql, schema, withTenant, type TenantDb } from "@angelic/db";
import { zonedToInstant } from "@angelic/core";
import { auth } from "../src/lib/auth";
import { ensureTemplates } from "../src/server/workflows";
import { insertSeat } from "../src/server/classes";
import { createSeries } from "../src/server/series";
import { refundPayment, refundToStoreCredit } from "../src/server/sales";
import { finalizePayroll } from "../src/server/payroll";
import { listRefundReasons } from "../src/server/refund-reasons";
import { seedDemoPhotos } from "./demo-photos";
import { appUrl } from "../src/lib/stripe";
import { PACKAGE_BLURBS, PACKAGE_PHOTOS, productArt } from "./demo-art";

/** Local demos use a known password; a hosted demo must set DEMO_PASSWORD to its own secret (see the guard in main). */
const DEMO_PASSWORD = process.env.DEMO_PASSWORD || "demo-salon-2026";
const RESET = process.argv.includes("--reset");
const PROFILE_KEY = process.argv.includes("--profile") ? (process.argv[process.argv.indexOf("--profile") + 1] ?? "luxe") : "luxe";

type LocationDef = { name: string; address1: string; city: string; state: string; phone: string; hours: Record<string, { open: string; close: string } | null> };
type Profile = {
  email: string; password: string; slug: string; name: string; tz: string; brandColor: string; tagline: string; about: string; website: string; instagram: string; phone: string; contactEmail: string; addressLine: string; coverEmoji: string; giftPrefix: string;
  locations: LocationDef[];
  /** Which staff (by index into STAFF) work at which location; everyone else goes to location 0. */
  staffLocation: Record<number, number>;
  /** Staff index -> weekday -> site index, for days a person works somewhere other than their home site. */
  otherSite: Record<number, Record<number, number>>;
};
const WEEK = { "0": null, "1": { open: "10:00", close: "18:00" }, "2": { open: "09:00", close: "19:00" }, "3": { open: "09:00", close: "19:00" }, "4": { open: "09:00", close: "20:00" }, "5": { open: "09:00", close: "19:00" }, "6": { open: "09:00", close: "17:00" } };
const PROFILES: Record<string, Profile> = {
  // One studio, every pay model, the richest history.
  luxe: {
    email: "demo@angelicbooking.com", password: DEMO_PASSWORD, slug: "demo-salon", name: "Luxe Beauty Studio", tz: "America/New_York", brandColor: "#be185d",
    tagline: "Lashes, brows, facials, waxing and permanent makeup",
    about: "A calm, light-filled studio in the heart of Sterling. Our team of specialists has been making clients feel their best since 2019. Walk-ins welcome when the calendar allows; booking online guarantees your spot.",
    website: "https://luxebeauty.demo", instagram: "luxebeautystudio", phone: "(703) 555-0142", contactEmail: "hello@luxebeauty.demo", addressLine: "128 Market Street, Sterling, VA 20164", coverEmoji: "🌿", giftPrefix: "LUXE",
    locations: [{ name: "Luxe Beauty Studio", address1: "128 Market Street", city: "Sterling", state: "VA", phone: "(703) 555-0142", hours: WEEK }],
    staffLocation: {},
    otherSite: {},
  },
  // Two sites: the booking page asks for a location, reports and reviews filter by it, staff and hours differ per site.
  glow: {
    email: "demo2@angelicbooking.com", password: DEMO_PASSWORD, slug: "demo-twosites", name: "Glow Collective", tz: "America/New_York", brandColor: "#0f766e",
    tagline: "Lash and skin studios in Arlington and Reston",
    about: "Glow Collective started as a two-chair studio in Arlington and opened its Reston location in 2023. Book at whichever is closer; your history, packages and points follow you.",
    website: "https://glowcollective.demo", instagram: "glowcollective", phone: "(571) 555-0190", contactEmail: "hello@glowcollective.demo", addressLine: "Arlington & Reston, VA", coverEmoji: "✨", giftPrefix: "GLOW",
    locations: [
      { name: "Glow Collective - Arlington", address1: "2200 Clarendon Blvd", city: "Arlington", state: "VA", phone: "(571) 555-0190", hours: WEEK },
      { name: "Glow Collective - Reston", address1: "11900 Market Street", city: "Reston", state: "VA", phone: "(571) 555-0191", hours: { ...WEEK, "0": { open: "10:00", close: "16:00" }, "1": null } },
    ],
    staffLocation: { 2: 1, 3: 1, 4: 1 },
    // Jordan lends Wednesdays to Reston; Priya, Sofia and Mina spend a few days at Arlington.
    otherSite: { 1: { 3: 1 }, 2: { 2: 0, 6: 0 }, 3: { 1: 0, 5: 0 }, 4: { 4: 0 } },
  },
};
const PROFILE: Profile = PROFILES[PROFILE_KEY] ?? (() => { throw new Error(`Unknown profile "${PROFILE_KEY}". Known: ${Object.keys(PROFILES).join(", ")}`); })();
const { email: EMAIL, password: PASSWORD, slug: SLUG, name: NAME, tz: TZ } = PROFILE;

// Deterministic pseudo-random so re-runs look the same.
let seed = PROFILE_KEY === "luxe" ? 20261010 : 20261011;
const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
const pick = <T,>(arr: readonly T[]): T => arr[Math.floor(rnd() * arr.length)]!;
const chance = (p: number) => rnd() < p;
const between = (a: number, b: number) => a + Math.floor(rnd() * (b - a + 1));
const isoDate = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (iso: string, n: number) => { const d = new Date(`${iso}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return isoDate(d); };
const today = isoDate(new Date());

// ---------------------------------------------------------------------------
// Placeholder images: a soft gradient tile with an emoji, stored like any upload.
// ---------------------------------------------------------------------------
const PALETTES = [["#f5d0fe", "#a21caf"], ["#fde68a", "#b45309"], ["#bbf7d0", "#15803d"], ["#bfdbfe", "#1d4ed8"], ["#fecaca", "#b91c1c"], ["#ddd6fe", "#6d28d9"], ["#fbcfe8", "#be185d"], ["#99f6e4", "#0f766e"], ["#fed7aa", "#c2410c"], ["#e7e5e4", "#44403c"]];
async function tile(businessId: string, kind: "category" | "service" | "package", label: string, emoji: string, i: number): Promise<string> {
  const [a, b] = PALETTES[i % PALETTES.length]!;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="500" height="300" viewBox="0 0 500 300"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient></defs><rect width="500" height="300" fill="url(#g)"/><circle cx="420" cy="60" r="90" fill="#fff" fill-opacity="0.12"/><circle cx="60" cy="260" r="70" fill="#fff" fill-opacity="0.1"/><text x="250" y="165" font-size="110" text-anchor="middle" dominant-baseline="middle">${emoji}</text><text x="250" y="262" font-family="system-ui, -apple-system, Segoe UI, sans-serif" font-size="22" font-weight="600" fill="#fff" fill-opacity="0.9" text-anchor="middle">${label.replace(/&/g, "&amp;")}</text></svg>`;
  const data = Buffer.from(svg, "utf8");
  const [row] = await db.insert(schema.files).values({ businessId, kind, contentType: "image/svg+xml", size: data.length, data }).returning({ id: schema.files.id });
  return appUrl(`/api/files/${row!.id}`);
}

// ---------------------------------------------------------------------------
// Menu: Angelic Beauty's real menu (angelicbeautyva.com, 2026-10) with the studio's own photos.
// ---------------------------------------------------------------------------
const IMG = "https://angelicbeauty.s3.us-east-2.amazonaws.com/images/";
const fetched = new Map<string, Promise<{ data: Buffer; type: string } | null>>();
/** Store one of the studio's photos as an uploaded file; falls back to a gradient tile if it can't be fetched. */
async function photo(businessId: string, kind: "category" | "service" | "package", path: string | undefined, label: string, emoji: string, i: number): Promise<string> {
  if (!path) return tile(businessId, kind, label, emoji, i);
  if (!fetched.has(path)) {
    fetched.set(path, (async () => {
      try {
        const r = await fetch(IMG + path);
        if (!r.ok) return null;
        return { data: Buffer.from(await r.arrayBuffer()), type: r.headers.get("content-type")?.split(";")[0] || "image/jpeg" };
      } catch { return null; }
    })());
  }
  const got = await fetched.get(path)!;
  if (!got) return tile(businessId, kind, label, emoji, i);
  const [row] = await db.insert(schema.files).values({ businessId, kind, contentType: got.type, size: got.data.length, data: got.data }).returning({ id: schema.files.id });
  return appUrl(`/api/files/${row!.id}`);
}

type Svc = { name: string; min: number; price: number; gap?: number; finish?: number; deposit?: number; desc?: string; emoji: string; capacity?: number; prep?: string; img?: string };
type Cat = { name: string; emoji: string; desc: string; prep?: string; img?: string; children?: Cat[]; services?: Svc[]; /** glow profile: offered only at this location index */ onlyAt?: number };
const lashSet = (style: string, img: string, full: number, fills: [number, number, number], extra?: string): Svc[] => [
  { name: `${style} Full Set`, min: 120, price: full * 100, deposit: 5000, emoji: "👁️", img: `lash_extensions/types/${img}.jpg`, desc: extra },
  { name: `${style} 2 Week Fill`, min: 60, price: fills[0] * 100, emoji: "🪄", img: `lash_extensions/types/${img}.jpg` },
  { name: `${style} 3 Week Fill`, min: 75, price: fills[1] * 100, emoji: "🪄", img: `lash_extensions/types/${img}.jpg` },
  { name: `${style} 4 Week Fill`, min: 90, price: fills[2] * 100, emoji: "🪄", img: `lash_extensions/types/${img}.jpg` },
];
const MENU: Cat[] = [
  { name: "Lash Extensions", emoji: "👁️", desc: "Traditional and LED lash systems with custom styling for natural, soft glam and full-volume looks.", img: "services/lash.jpg", prep: "Please arrive with clean, mascara-free lashes and no eye make-up. Skip caffeine right before so you can relax with your eyes closed.", children: [
    { name: "Classic", emoji: "👁️", desc: "One extension per natural lash for a soft, mascara-like finish.", img: "lash_extensions/types/classic.jpg", services: lashSet("Classic", "classic", 160, [65, 85, 110], "One extension per natural lash. Best if you're new to extensions or want a natural, everyday look.") },
    { name: "Hybrid", emoji: "✨", desc: "A mix of classic and volume fans for texture and fullness.", img: "lash_extensions/types/hybrid.jpg", services: lashSet("Hybrid", "hybrid", 180, [75, 100, 125], "Classic lashes blended with light volume fans for a fuller, textured look.") },
    { name: "Volume", emoji: "🌟", desc: "Handmade fans for a full, fluffy, glamorous set.", img: "lash_extensions/types/volume.jpg", services: lashSet("Volume", "volume", 200, [80, 115, 135], "Handmade 3D–6D fans for full, fluffy glamour.") },
    { name: "Mega Volume", emoji: "💫", desc: "Our fullest, darkest set.", img: "lash_extensions/types/mega.jpg", services: lashSet("Mega Volume", "mega", 240, [100, 139, 160], "Ultra-fine 8D+ fans for the fullest, darkest look.") },
    { name: "Signature Styles", emoji: "🎀", desc: "Mascara, Foxy, Point and Feather styling.", img: "lash_extensions/types/feather.jpg", services: [
      { name: "Mascara Style Full Set", min: 120, price: 18000, deposit: 5000, emoji: "👁️", img: "lash_extensions/types/mascara.jpg", desc: "Dark, defined lashes with a mascara-coated finish." },
      { name: "Foxy Style Full Set", min: 120, price: 18000, deposit: 5000, emoji: "🦊", img: "lash_extensions/types/foxy.jpg", desc: "Lifted outer corners for an elongated, foxy eye." },
      { name: "Point Style Full Set", min: 120, price: 18000, deposit: 5000, emoji: "✨", img: "lash_extensions/types/point.jpg", desc: "Spiky, wispy accents for a doll-like look." },
      { name: "Feather Style Full Set", min: 120, price: 18000, deposit: 5000, emoji: "🪶", img: "lash_extensions/types/feather.jpg", desc: "Soft, airy layers with a feathered finish." },
      { name: "Fill from Another Studio", min: 90, price: 12500, emoji: "🔁", img: "lash_extensions/types/classic.jpg", desc: "A fill on a set applied elsewhere. We'll check the work first; a removal may be recommended." },
      { name: "Lash Removal", min: 30, price: 3000, emoji: "🧼", desc: "Gentle removal of extensions." },
    ] },
  ] },
  { name: "Korean Lash Lift & Tint", emoji: "🌙", desc: "Lifts, curls and darkens your natural lashes for effortlessly defined eyes. Results last 6–8 weeks.", img: "services/lash_lift.jpg", prep: "Come with clean, mascara-free lashes and take out contact lenses. Nothing on the lashes for 24 hours afterwards.", services: [
    { name: "Korean Lash Lift (ECO)", min: 45, price: 9000, emoji: "🌙", img: "lash_lifts/before_vs_after/lift1.jpg", desc: "The ECO lift system for a natural curl without damage." },
    { name: "Korean Lash Lift (ECO) & Tint", min: 60, price: 12000, emoji: "🌙", img: "lash_lifts/before_vs_after/lift2.jpg", desc: "Lift plus a custom tint for mascara-free definition." },
    { name: "Lash Lift & Tint + Bottom Lash Lift", min: 75, price: 16000, emoji: "🌙", img: "lash_lifts/before_vs_after/lift3.jpg" },
    { name: "Lash Tint", min: 15, price: 3000, emoji: "🖤", img: "lash_lifts/before_vs_after/lift4.jpg" },
    { name: "Bottom Lash Lift (ECO)", min: 30, price: 5000, emoji: "🌙", img: "lash_lifts/before_vs_after/lift5.jpg" },
  ] },
  { name: "Facial Treatments", emoji: "🧖‍♀️", desc: "Korean-inspired skin therapy planned around your skin's condition, goals and barrier health.", img: "services/facial.jpg", prep: "Arrive make-up free (or allow a few minutes to cleanse) and stop retinol or acids 3 days before.", children: [
    { name: "Core Facials", emoji: "✨", desc: "Start with a consultation; corrective and maintenance options.", img: "facial/glow.jpg", services: [
      { name: "Facial Consultation", min: 30, price: 5000, emoji: "🩺", img: "facial/korean_consultation.jpg", desc: "Start here if you're new or unsure of your skin type. Credited toward a facial booked the same day." },
      { name: "Glow Facial", min: 60, price: 13000, emoji: "✨", img: "facial/glow.jpg", desc: "For dullness, dryness and uneven texture; great before an event." },
      { name: "Oxygen Facial (with LDM)", min: 70, price: 18000, emoji: "💧", img: "facial/oxygen.jpg", desc: "Extreme dryness, sensitive skin, damaged barrier or post-travel fatigue." },
      { name: "V-Lift Facial", min: 75, price: 20000, emoji: "🔼", img: "facial/vlift.jpg", desc: "Sagging skin, double chin and loss of elasticity." },
      { name: "BioPeel Facial", min: 75, price: 25000, emoji: "🧪", img: "facial/biorepeel.jpg", desc: "Active acne, scars, large pores and pigmentation." },
      { name: "Booster Facial (Customized)", min: 75, price: 25000, emoji: "💉", img: "facial/bio_booster.jpg", desc: "Aging, dull or dry skin; ampoule chosen for you." },
      { name: "BioPeel + Booster Luxury Facial", min: 90, price: 32500, emoji: "👑", img: "facial/boosterak.jpg" },
      { name: "Hair Growth Treatment", min: 45, price: 20000, emoji: "🌱", img: "facial/hair.jpg", desc: "Scalp care, 1 ml." },
    ] },
    { name: "Korean Facials", emoji: "🇰🇷", desc: "Signature programmes with LAVIEN skincare.", img: "services/korean_facial_header.jpg", services: [
      { name: "Korean Skin Science Facial", min: 60, price: 13000, emoji: "🧪", img: "facial/korean_skin_science.jpg", desc: "Our signature 60-minute facial." },
      { name: "Korean LDM Recovery Facial", min: 70, price: 18000, emoji: "💧", img: "facial/korean_ldm_recovery.jpg", desc: "Calm and recover." },
      { name: "Korean Lift & Firm Facial", min: 75, price: 25000, emoji: "🔼", img: "facial/korean_lift_firm.jpg", desc: "Anti-aging with LDM lifting." },
      { name: "Korean Glass Skin Facial", min: 75, price: 26500, emoji: "🪞", img: "facial/korean_glass_skin.jpg", desc: "Glow and hydration." },
      { name: "BioLux Korean Facial", min: 80, price: 35000, emoji: "👑", img: "facial/korean_biolux.jpg", desc: "Signature luxury." },
    ] },
    { name: "Facial Add-ons", emoji: "➕", desc: "Enhance any facial.", img: "facial/addon/ldm.jpg", services: [
      { name: "Micro-Needling (MTS)", min: 20, price: 5000, emoji: "💉", img: "facial/addon/micro_shot.jpg", desc: "Boosts collagen and product absorption. Recommended with BioPeel." },
      { name: "Water Drop Lifting (LDM)", min: 15, price: 5000, emoji: "💧", img: "facial/addon/ldm.jpg", desc: "High-density ultrasound for moisture and calming." },
      { name: "BioPeel Spot Treatment", min: 15, price: 5000, emoji: "🎯", img: "facial/addon/bio_peel_spot.jpg" },
      { name: "LED Light Therapy", min: 15, price: 5000, emoji: "💡", img: "facial/addon/led_therapy.jpg" },
      { name: "Hydrojelly Mask", min: 10, price: 2000, emoji: "🧊", img: "facial/addon/hydro_jelly_mask.jpg" },
      { name: "Black Caviar Lift Mask", min: 10, price: 2500, emoji: "🖤", img: "facial/addon/black_caviar_mask.jpg" },
      { name: "Hand Mask", min: 10, price: 2000, emoji: "🤲", img: "facial/addon/hand_mask.jpg" },
      { name: "Foot Mask", min: 10, price: 2500, emoji: "🦶", img: "facial/addon/foot_mask.jpg" },
      { name: "Hydrating Eye Patch", min: 5, price: 1000, emoji: "👀", img: "facial/addon/eye_patch.jpg" },
    ] },
  ] },
  { name: "Waxing", emoji: "🪒", desc: "Face and body waxing with a skin-conscious approach: precision, hygiene and comfort.", img: "services/waxing.jpg", prep: "Hair should be about ¼ inch long. Avoid sun or tanning for 24 hours and skip lotions or oils on the day. If you're sensitive, an over-the-counter pain reliever 30 minutes before helps.", children: [
    { name: "Face", emoji: "😊", desc: "", services: [
      { name: "Eyebrow Wax", min: 10, price: 1300, emoji: "🪒" }, { name: "Brow Wax + Mapping", min: 15, price: 2000, emoji: "🪒", desc: "Consultation, mapping and shaping." },
      { name: "Upper Lip Wax", min: 10, price: 1300, emoji: "🪒" }, { name: "Chin Wax", min: 10, price: 1300, emoji: "🪒" }, { name: "Nose Wax", min: 10, price: 1600, emoji: "🪒" },
      { name: "Sideburn Wax", min: 10, price: 1300, emoji: "🪒" }, { name: "Forehead Wax", min: 10, price: 1300, emoji: "🪒" }, { name: "Cheek Wax", min: 10, price: 1600, emoji: "🪒" },
      { name: "Full Face Wax", min: 45, price: 6500, emoji: "🪒", desc: "Brows, forehead, cheeks, sideburns, upper lip and chin. Saves $16." },
    ] },
    { name: "Body", emoji: "💪", desc: "", services: [
      { name: "Under Arm Wax", min: 15, price: 2500, emoji: "🪒" }, { name: "Half Arm Wax", min: 20, price: 3500, emoji: "🪒" }, { name: "Full Arm Wax", min: 30, price: 5400, emoji: "🪒" },
      { name: "Half Leg Wax", min: 30, price: 4500, emoji: "🪒" }, { name: "Full Leg Wax", min: 45, price: 7000, emoji: "🪒" }, { name: "Back Wax", min: 30, price: 4500, emoji: "🪒" }, { name: "Chest Wax", min: 30, price: 5500, emoji: "🪒" },
    ] },
    { name: "Bikini", emoji: "👙", desc: "", services: [
      { name: "Bikini Line Wax", min: 20, price: 4500, emoji: "🪒" }, { name: "Full Bikini Wax", min: 30, price: 5500, emoji: "🪒" }, { name: "Brazilian Wax", min: 30, price: 6500, emoji: "🪒" },
      { name: "Brazilian Wax + Vagacial Combo", min: 60, price: 12500, emoji: "🪒", desc: "Brazilian wax followed by a soothing vagacial." },
    ] },
  ] },
  { name: "Brow Lamination & Tint", emoji: "🪶", desc: "Lifts, sets and defines your brow hairs for a full, fluffy look that lasts weeks.", img: "services/brows.jpg", prep: "Come with clean brows and no make-up around them. Avoid retinol near the brows for 48 hours before.", services: [
    { name: "Brow Tint", min: 15, price: 3000, emoji: "🖌️", img: "brow_lamination/brow1.jpg", desc: "Colour filled along your existing shape; trimming and tweezer clean-up included." },
    { name: "Signature Brow Mapping + Hair Strokes", min: 30, price: 5500, emoji: "✏️", img: "brow_lamination/brow2.jpg", desc: "Mapped to your proportions, then drawn one hair at a time with premium pigment." },
    { name: "Signature Brow Mapping + Hair Strokes + Wax", min: 45, price: 6500, emoji: "✏️", img: "brow_lamination/brow3.jpg", desc: "Our signature brow design. Most popular." },
    { name: "Brow Lamination", min: 30, price: 8500, emoji: "🪶", img: "brow_lamination/brow4.jpg", desc: "Lift and smooth your natural brows into a fuller, fluffy shape." },
    { name: "Brow Lamination + Tint", min: 45, price: 10000, emoji: "🪶", img: "brow_lamination/brow5.jpg" },
    { name: "Signature Brow Transformation", min: 75, price: 12900, emoji: "👑", img: "brow_lamination/brow6.jpg", desc: "Lamination, mapping, hair strokes and waxing. Saves $21." },
  ] },
  { name: "Personal Color Analysis", emoji: "🎨", desc: "A precision image consultation built on Korean diagnostic methods, adapted for U.S. skin tones.", img: "services/personal_color.jpg", onlyAt: 1, prep: "Please come bare-faced (or allow a few minutes to cleanse) and take out coloured contact lenses.", services: [
    { name: "Signature Personal Color", min: 60, price: 20000, emoji: "🎨", img: "personal_color_analysis/color1.jpg", desc: "Your type, palette and beauty matches, with a digital report within 72 hours." },
    { name: "Duo Personal Color", min: 90, price: 35000, emoji: "👯", img: "personal_color_analysis/color2.jpg", desc: "For two people." },
    { name: "Color + Style", min: 90, price: 35000, emoji: "👗", img: "personal_color_analysis/color4.jpg", desc: "Colour analysis plus a style report and shopping links." },
    { name: "Duo Color + Style", min: 150, price: 55000, emoji: "👯", img: "personal_color_analysis/color5.jpg", desc: "For two people." },
  ] },
  { name: "Permanent Makeup", emoji: "💄", desc: "High-precision PMU through our partnership with Grand Master Artist Ally.", img: "services/permanent_makeup.jpg", prep: "No alcohol, caffeine or blood thinners for 24 hours and no retinol for two weeks. Eat before you come; plan on 2–3 hours.", services: [
    { name: "Nanobrows", min: 180, price: 85000, deposit: 10000, emoji: "✒️", desc: "Ultra-fine strokes that mimic natural hair." },
    { name: "Ombre / Microshading", min: 180, price: 85000, deposit: 10000, emoji: "🌫️", desc: "A soft, misty graduation of colour." },
    { name: "Correction / Coverup", min: 180, price: 90000, deposit: 10000, emoji: "🩹", desc: "Revision of previous PMU work from other studios." },
    { name: "Brows Removal", min: 60, price: 30000, deposit: 10000, emoji: "🧼" },
    { name: "Lip Blush", min: 150, price: 75000, deposit: 10000, emoji: "💋", desc: "A healthy, youthful flush of colour and volume." },
    { name: "Eyeliner", min: 120, price: 65000, deposit: 10000, emoji: "👁️" },
    { name: "6–12 Week Touchup", min: 90, price: 15000, emoji: "🔁", desc: "Existing clients only." },
    { name: "1–4 Year Touchup", min: 120, price: 45000, emoji: "🔁", desc: "Existing clients only." },
  ] },
  { name: "Training & Classes", emoji: "🎓", desc: "Angelic Beauty Academy: a mentorship pathway from classic foundations to advanced artistry.", img: "services/classes_and_training.jpg", services: [
    { name: "Classic Lash Foundations", min: 480, price: 120000, capacity: 6, emoji: "🎓", desc: "Two-day fundamentals course with kit." },
    { name: "Volume Lash Masterclass", min: 480, price: 150000, capacity: 6, emoji: "🎓", desc: "Advanced fan-making and styling." },
    { name: "Korean ECO Lash Lift Certification", min: 240, price: 65000, capacity: 6, emoji: "🎓" },
  ] },
];

/** weekday (0 = Sunday) -> [start, end]. Hours differ by person and day so coverage differs by category. */
type Hours = Record<number, [string, string]>;
type StaffDef = { name: string; email: string; color: string; position: string; payType: "commission" | "hourly" | "salary"; main?: number; product: number; hourly?: number; salary?: number; skills: string[]; hours: Hours; frontDesk?: boolean };
const STAFF: StaffDef[] = [
  // Lashes: Ava owns Thursday evenings and Saturdays, Jordan Mondays and Friday evenings; Thursday mornings have no lash artist.
  { name: "Ava Martinez", email: "ava@luxebeauty.demo", color: "#db2777", position: "Signature Master Lash Artist", payType: "commission", main: 4500, product: 1000, skills: ["Lash Extensions", "Korean Lash Lift & Tint"], hours: { 2: ["09:00", "18:00"], 3: ["09:00", "18:00"], 4: ["12:00", "20:00"], 5: ["09:00", "18:00"], 6: ["09:00", "17:00"] } },
  { name: "Jordan Lee", email: "jordan@luxebeauty.demo", color: "#2563eb", position: "Lash Artist", payType: "hourly", hourly: 2200, main: 1500, product: 500, skills: ["Lash Extensions", "Korean Lash Lift & Tint"], hours: { 1: ["10:00", "18:00"], 2: ["12:00", "19:00"], 3: ["09:00", "15:00"], 5: ["09:00", "19:00"] } },
  // Facials: only Priya, so Mondays, Fridays and Thursday afternoons are uncovered.
  { name: "Priya Nair", email: "priya@luxebeauty.demo", color: "#059669", position: "Esthetician", payType: "commission", main: 5000, product: 500, skills: ["Facial Treatments", "Waxing"], hours: { 2: ["09:00", "19:00"], 3: ["09:00", "19:00"], 4: ["09:00", "16:00"], 6: ["09:00", "17:00"] } },
  // Brows: only Sofia (no Tuesday or Saturday). Waxing: Priya and Sofia overlap only some days.
  { name: "Sofia Rossi", email: "sofia@luxebeauty.demo", color: "#7c3aed", position: "Brow & Wax Specialist", payType: "hourly", hourly: 2000, main: 2000, product: 500, skills: ["Brow Lamination & Tint", "Waxing", "Korean Lash Lift & Tint"], hours: { 1: ["10:00", "18:00"], 3: ["09:00", "19:00"], 4: ["12:00", "20:00"], 5: ["09:00", "19:00"] } },
  // Colour analysis and permanent makeup: Mina is out Wednesdays and Fridays.
  { name: "Mina Park", email: "mina@luxebeauty.demo", color: "#d97706", position: "Color Consultant & PMU Artist", payType: "commission", main: 5500, product: 500, skills: ["Personal Color Analysis", "Permanent Makeup"], hours: { 1: ["10:00", "18:00"], 2: ["10:00", "19:00"], 4: ["09:00", "17:00"], 6: ["09:00", "17:00"] } },
  { name: "Dana Whitfield", email: "dana@luxebeauty.demo", color: "#64748b", position: "Front Desk", payType: "salary", salary: 180000, product: 500, skills: [], hours: { 1: ["10:00", "18:00"], 2: ["09:00", "18:00"], 3: ["09:00", "18:00"], 4: ["09:00", "18:00"], 5: ["09:00", "18:00"] }, frontDesk: true },
];

// ---- Dates and working windows (all relative to the day the script runs) ----
const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
const minToTime = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
const dowOf = (day: string) => new Date(`${day}T00:00:00Z`).getUTCDay();
/** Smallest day offset >= from that falls on `weekday`. */
const dowOffset = (weekday: number, from: number) => { let o = from; while (dowOf(addDays(today, o)) !== weekday) o++; return o; };
/** A person's regular window on a weekday at a site: their hours trimmed to the site's opening hours, or null. */
function baseWindow(hours: Hours, siteIdx: number, weekday: number): { start: number; end: number } | null {
  const mine = hours[weekday];
  const site = PROFILE.locations[siteIdx]?.hours[String(weekday)];
  if (!mine || !site) return null;
  const start = Math.max(toMin(mine[0]), toMin(site.open));
  const end = Math.min(toMin(mine[1]), toMin(site.close));
  return end - start >= 120 ? { start, end } : null;
}

const FIRST = ["Emma", "Olivia", "Sophia", "Isabella", "Mia", "Charlotte", "Amelia", "Harper", "Evelyn", "Abigail", "Ella", "Scarlett", "Grace", "Chloe", "Victoria", "Riley", "Aria", "Lily", "Zoe", "Nora", "Hannah", "Layla", "Ellie", "Natalie", "Leah", "Liam", "Noah", "Ethan", "Lucas", "Mason", "Daniel", "James", "Aiden", "Henry", "Owen", "Maya", "Jasmine", "Naomi", "Camila", "Ruby"];
const LAST = ["Johnson", "Williams", "Brown", "Jones", "Garcia", "Miller", "Davis", "Rodriguez", "Martinez", "Hernandez", "Lopez", "Gonzalez", "Wilson", "Anderson", "Thomas", "Taylor", "Moore", "Jackson", "Martin", "Lee", "Perez", "Thompson", "White", "Harris", "Sanchez", "Clark", "Ramirez", "Lewis", "Robinson", "Walker", "Young", "Allen", "King", "Wright", "Scott", "Torres", "Nguyen", "Hill", "Flores", "Green"];
const COMMENTS = ["My hybrid set looks so natural. Ava is meticulous and quick.", "Clean, calm and on time. Will be back.", "Three weeks in and my volume lashes are still perfect.", "Jordan explained every style and picked the right one for my eye shape.", "The lash lift and tint is my new favourite thing. No mascara needed.", "Mina's colour analysis changed how I shop. Worth every penny.", "Lovely studio, easy online booking, friendly front desk.", "A little pricey but the Korean facial left my skin glowing for a week.", "Priya is thorough and gentle. Best Brazilian I've had.", "Sofia's brow lamination gave me the fluffy brows I wanted.", "Ran about 10 minutes late but the service was great.", "The LDM facial calmed my skin right down after travel."];
type SeedProduct = { cat: string; name: string; label?: string; price: number; cost: number; qty: number; sold: number; supplier: string; low: number; upTo?: number; backbar?: boolean; written?: [reason: "damage" | "theft" | "expired" | "lost", units: number]; recv?: { qty: number; po: 1 | 3; daysAgo: number } };
// Retail first, then the back-bar products services use up. `sold` is units sold (or used) over the last 85 days; `qty` is what is on the shelf now.
const PRODUCTS: SeedProduct[] = [
  { cat: "Lash care", name: "Lash Cleanser Foam", label: "50 ml", price: 2200, cost: 900, qty: 14, sold: 42, supplier: "Luxe Lash Supply", low: 5, upTo: 24, recv: { qty: 24, po: 1, daysAgo: 30 }, written: ["damage", 1] },
  { cat: "Lash care", name: "Lash Cleanser Foam", label: "100 ml", price: 3600, cost: 1500, qty: 4, sold: 14, supplier: "Luxe Lash Supply", low: 5, upTo: 12 },
  { cat: "Lash care", name: "Lash Cleansing Brush", price: 800, cost: 300, qty: 25, sold: 20, supplier: "Salon Essentials Wholesale", low: 8, upTo: 40 },
  { cat: "Lash care", name: "Lash Sealant", price: 2400, cost: 1000, qty: 0, sold: 30, supplier: "Luxe Lash Supply", low: 3, upTo: 18 },
  { cat: "Lash care", name: "Lash Growth Serum", price: 6500, cost: 3000, qty: 2, sold: 12, supplier: "Luxe Lash Supply", low: 3, upTo: 10 },
  { cat: "Skin care", name: "Vitamin C Serum", price: 5800, cost: 2400, qty: 8, sold: 16, supplier: "Pure Skin Distributors", low: 3, upTo: 16, written: ["expired", 2] },
  { cat: "Skin care", name: "Daily SPF 50", label: "50 ml", price: 3200, cost: 1300, qty: 9, sold: 24, supplier: "Pure Skin Distributors", low: 4, upTo: 18 },
  { cat: "Skin care", name: "Daily SPF 50", label: "100 ml", price: 5400, cost: 2300, qty: 3, sold: 9, supplier: "Pure Skin Distributors", low: 3, upTo: 12, recv: { qty: 6, po: 3, daysAgo: 5 } },
  { cat: "Skin care", name: "Gentle Cleanser", price: 2600, cost: 1000, qty: 12, sold: 15, supplier: "Pure Skin Distributors", low: 4, upTo: 20 },
  { cat: "Skin care", name: "LAVIEN Centella Toner", price: 3800, cost: 1700, qty: 9, sold: 11, supplier: "Pure Skin Distributors", low: 3, upTo: 15 },
  { cat: "Skin care", name: "LAVIEN Collagen Essence", price: 5200, cost: 2400, qty: 7, sold: 8, supplier: "Pure Skin Distributors", low: 3, upTo: 12 },
  { cat: "Tools & Gifts", name: "Silk Sleep Mask", price: 2800, cost: 1200, qty: 6, sold: 3, supplier: "Salon Essentials Wholesale", low: 2, upTo: 8, written: ["theft", 1] },
  { cat: "Tools & Gifts", name: "Silk Pillowcase", price: 4500, cost: 2000, qty: 5, sold: 0, supplier: "Salon Essentials Wholesale", low: 2, upTo: 6 },
  { cat: "Tools & Gifts", name: "Luxe Gift Box", price: 7500, cost: 3500, qty: 3, sold: 0, supplier: "Salon Essentials Wholesale", low: 2, upTo: 6 },
  { cat: "Back-bar", name: "Lash Adhesive (pro)", price: 0, cost: 2800, qty: 3, sold: 18, supplier: "Luxe Lash Supply", low: 2, upTo: 8, backbar: true },
  { cat: "Back-bar", name: "Classic lash trays", label: "0.15", price: 0, cost: 1500, qty: 10, sold: 30, supplier: "Luxe Lash Supply", low: 4, upTo: 16, backbar: true, recv: { qty: 20, po: 1, daysAgo: 30 } },
  { cat: "Back-bar", name: "Volume lash trays", label: "0.07", price: 0, cost: 1800, qty: 4, sold: 26, supplier: "Luxe Lash Supply", low: 4, upTo: 16, backbar: true },
  { cat: "Back-bar", name: "Eye gel patches (pair)", price: 0, cost: 40, qty: 90, sold: 170, supplier: "Salon Essentials Wholesale", low: 60, upTo: 400, backbar: true },
  { cat: "Back-bar", name: "Facial mask sheets", price: 0, cost: 150, qty: 36, sold: 40, supplier: "Pure Skin Distributors", low: 15, upTo: 80, backbar: true },
  { cat: "Back-bar", name: "Disposable applicators", price: 0, cost: 10, qty: 150, sold: 120, supplier: "Salon Essentials Wholesale", low: 50, upTo: 300, backbar: true },
];
// What one visit of a kind of service uses up (matched on the service's name or group).
const USAGE: { match: RegExp; uses: [product: string, qty: number, mode: "auto" | "log"][] }[] = [
  { match: /classic.*(set|fill)|(set|fill).*classic/i, uses: [["Lash Adhesive (pro)", 1, "log"], ["Classic lash trays", 1, "log"], ["Eye gel patches (pair)", 2, "auto"], ["Disposable applicators", 4, "auto"]] },
  { match: /volume|hybrid|mega/i, uses: [["Lash Adhesive (pro)", 1, "log"], ["Volume lash trays", 1, "log"], ["Eye gel patches (pair)", 2, "auto"], ["Disposable applicators", 4, "auto"]] },
  // A retail product that is also used in the treatment.
  { match: /facial/i, uses: [["Facial mask sheets", 1, "auto"], ["Disposable applicators", 2, "auto"], ["Gentle Cleanser", 1, "log"]] },
];

// ---------------------------------------------------------------------------
async function main() {
  // Demo pictures stay in Postgres, never in the real R2 bucket; and this script only ever runs against a local database.
  process.env.R2_ACCESS_KEY_ID = "";
  process.env.R2_SECRET_ACCESS_KEY = "";
  const local = /@(localhost|127\.0\.0\.1|\[::1\])(:|\/)/.test(process.env.DATABASE_URL ?? "");
  const remoteOk = process.argv.includes("--allow-remote") || process.env.DEMO_ALLOW_REMOTE === "1";
  if (!local && !remoteOk) throw new Error("DATABASE_URL is not a local database. Pass --allow-remote (or set DEMO_ALLOW_REMOTE=1) if you really mean to seed a hosted demo.");
  // The repo's default password is public, so a hosted demo must use its own.
  if (!local && (!process.env.DEMO_PASSWORD || process.env.DEMO_PASSWORD === "demo-salon-2026")) throw new Error("Set DEMO_PASSWORD to a secret of your own before seeding a hosted demo.");
  const pg = getSql();
  const existingBiz = await db.query.businesses.findFirst({ where: eq(schema.businesses.slug, SLUG) });
  if (existingBiz && !RESET) {
    console.log(`Demo business "${SLUG}" already exists. Re-run with --reset to rebuild it.\nLogin: ${EMAIL} / ${PASSWORD}`);
    await pg.end();
    return;
  }
  if (existingBiz) {
    console.log("Deleting the existing demo business…");
    // Tenant tables cascade from businesses; files are unscoped so clear them by business id.
    await db.delete(schema.files).where(eq(schema.files.businessId, existingBiz.id));
    await db.delete(schema.organization).where(eq(schema.organization.id, existingBiz.id));
  }

  // --- User (Better Auth) and organization (runs the afterCreateOrganization hook)
  const makeUser = async () => {
    await auth.api.signUpEmail({ body: { email: EMAIL, password: PASSWORD, name: "Demo Owner" } });
    const created = (await db.query.user.findFirst({ where: eq(schema.user.email, EMAIL) }))!;
    await db.update(schema.user).set({ emailVerified: true }).where(eq(schema.user.id, created.id));
    return created;
  };
  let user = (await db.query.user.findFirst({ where: eq(schema.user.email, EMAIL) })) ?? (await makeUser());
  let signIn;
  try {
    signIn = await auth.api.signInEmail({ body: { email: EMAIL, password: PASSWORD }, returnHeaders: true });
  } catch {
    // The demo password was changed (DEMO_PASSWORD): the demo login is only for the demo, so make it again with the new one.
    console.log("Demo login no longer matches DEMO_PASSWORD; recreating it.");
    await db.delete(schema.user).where(eq(schema.user.id, user.id));
    user = await makeUser();
    signIn = await auth.api.signInEmail({ body: { email: EMAIL, password: PASSWORD }, returnHeaders: true });
  }
  const cookie = (signIn.headers.getSetCookie?.() ?? [signIn.headers.get("set-cookie") ?? ""]).map((c) => c.split(";")[0]).filter(Boolean).join("; ");
  const h = new Headers({ cookie });
  const org = await auth.api.createOrganization({ headers: h, body: { name: NAME, slug: SLUG, metadata: { timezone: TZ } } });
  if (!org) throw new Error("Could not create the demo organization");
  const businessId = org.id;
  console.log(`Created ${NAME} (${businessId})`);

  // --- Business profile and settings
  const logoUrl = await tile(businessId, "category", NAME.split(" ")[0]!, "✨", PROFILE_KEY === "luxe" ? 5 : 7);
  const coverUrl = await photo(businessId, "category", PROFILE_KEY === "luxe" ? "home_slide_images/slider1.jpg" : "home_slide_images/slider2.jpg", NAME, PROFILE.coverEmoji, PROFILE_KEY === "luxe" ? 7 : 2);
  await db.update(schema.businesses).set({
    phone: PROFILE.phone, email: PROFILE.contactEmail, addressLine: PROFILE.addressLine, tagline: PROFILE.tagline,
    about: PROFILE.about,
    website: PROFILE.website, instagram: PROFILE.instagram, brandColor: PROFILE.brandColor, logoUrl, coverUrl,
    bookingPolicy: "Please arrive 5 minutes early.", lateCancelFeeType: PROFILE_KEY === "glow" ? "percent" : "flat", lateCancelFeeValue: PROFILE_KEY === "glow" ? 5000 : 2500, cancelWindowHours: 24, reminderHours: 24, maxAdvanceDays: 60,
    reviewRequestEnabled: true, reviewRequestDelayHours: 2, googleReviewUrl: "https://g.page/r/demo/review", loyaltyEnabled: true, loyaltyPointsPerDollar: 1, loyaltyMinRedeemPoints: 500, referralBonusPoints: 500, referralFriendBonusPoints: 250,
    clientAccountsEnabled: true, storeEnabled: true, giftCardsOnline: true, shippingFlatCents: 795, taxRateBps: 600,
  }).where(eq(schema.businesses.id, businessId));

  /** Plans and ids the second phase (the app's own functions, outside the big transaction) needs. */
  const post: { classPlan?: any[]; seriesPlan?: any[]; clientIds?: { id: string; first: string; last: string }[]; ownerUserId?: string } = { ownerUserId: user.id };
  await withTenant(businessId, async (tx) => {
    // Locations: the hook made "Main location"; rename it and add the rest.
    const [first] = await tx.select().from(schema.locations);
    const locIds: string[] = [];
    for (const [li, L] of PROFILE.locations.entries()) {
      if (li === 0) {
        await tx.update(schema.locations).set({ name: L.name, addressLine1: L.address1, city: L.city, state: L.state, phone: L.phone, hours: L.hours }).where(eq(schema.locations.id, first!.id));
        locIds.push(first!.id);
      } else {
        const [row] = await tx.insert(schema.locations).values({ businessId, name: L.name, addressLine1: L.address1, city: L.city, state: L.state, phone: L.phone, hours: L.hours, isDefault: false }).returning({ id: schema.locations.id });
        locIds.push(row!.id);
      }
    }
    const multi = locIds.length > 1;
    const locationId = locIds[0]!; // default site: products, packages, the owner

    // --- Menu: nested categories with images, services with images
    const serviceIds: { id: string; name: string; min: number; price: number; gap: number; finish: number; group: string; root: string; capacity: number }[] = [];
    const colourIds: string[] = []; // services whose category requires the consent form (PMU here)
    let tileNo = 0;
    const insertCat = async (c: Cat, parentId: string | null, order: number, root: string, onlyAt: number | undefined): Promise<string> => {
      const imageUrl = await photo(businessId, "category", c.img, c.name, c.emoji, tileNo++);
      const [row] = await tx.insert(schema.serviceCategories).values({ businessId, name: c.name, parentId, description: c.desc || null, prepNotes: c.prep ?? null, imageUrl, sortOrder: order }).returning({ id: schema.serviceCategories.id });
      let i = 0;
      for (const child of c.children ?? []) await insertCat(child, row!.id, i++, root, onlyAt ?? child.onlyAt);
      let j = 0;
      for (const s of c.services ?? []) {
        const img = s.img ? await photo(businessId, "service", s.img, s.name, s.emoji, tileNo++) : null;
        const [sv] = await tx.insert(schema.services).values({ businessId, categoryId: row!.id, name: s.name, description: s.desc ?? null, prepNotes: s.prep ?? null, imageUrl: img, durationMin: s.min, gapMin: s.gap ?? 0, finishMin: s.finish ?? 0, bufferAfterMin: s.min >= 60 ? 10 : 5, priceCents: s.price, depositCents: s.deposit ?? 0, capacity: s.capacity ?? 1, sortOrder: j++ }).returning({ id: schema.services.id });
        serviceIds.push({ id: sv!.id, name: s.name, min: s.min, price: s.price, gap: s.gap ?? 0, finish: s.finish ?? 0, group: c.name, root, capacity: s.capacity ?? 1 });
        if (root === "Permanent Makeup") colourIds.push(sv!.id);
        // Some services exist at one site only (the website offers colour analysis in Fairfax).
        if (multi && onlyAt != null && locIds[onlyAt]) await tx.insert(schema.serviceLocations).values({ businessId, serviceId: sv!.id, locationId: locIds[onlyAt]! });
      }
      return row!.id;
    };
    let k = 0;
    for (const c of MENU) await insertCat(c, null, k++, c.name, c.onlyAt);
    console.log(`Menu: ${serviceIds.length} services`);

    // --- Staff (the owner row exists from the hook; make it a non-provider owner)
    const owner = (await tx.select().from(schema.staff))[0]!;
    await tx.update(schema.staff).set({ displayName: "Demo Owner", takesAppointments: false, bookableOnline: false, position: "Owner", payType: "salary", color: "#0f172a" }).where(eq(schema.staff.id, owner.id));
    await tx.delete(schema.staffSchedules).where(eq(schema.staffSchedules.staffId, owner.id));
    type StaffRow = { id: string; name: string; skills: string[]; hours: Hours; homeSite: number; siteByDay: Record<number, number>; hourly: boolean; frontDesk: boolean; locationId: string };
    const staffRows: StaffRow[] = [];
    for (const [i, s] of STAFF.entries()) {
      const staffLoc = locIds[PROFILE.staffLocation[i] ?? 0]!;
      const [row] = await tx.insert(schema.staff).values({
        businessId, displayName: s.name, email: s.email, color: s.color, locationId: staffLoc, position: s.position, payType: s.payType, mainCommissionBps: s.main ?? 0, productCommissionBps: s.product, ccTipFeeBps: 300,
        hourlyRateCents: s.hourly ?? 0, salaryPerPeriodCents: s.salary ?? 0, takesAppointments: !s.frontDesk, bookableOnline: !s.frontDesk, sortOrder: i,
      }).returning({ id: schema.staff.id });
      const homeSite = PROFILE.staffLocation[i] ?? 0;
      const siteByDay: Record<number, number> = { ...(PROFILE.otherSite[i] ?? {}) };
      const siteOn = (wd: number) => siteByDay[wd] ?? homeSite;
      const schedRows = Object.keys(s.hours).map(Number).flatMap((weekday) => {
        const w = baseWindow(s.hours, siteOn(weekday), weekday);
        return w ? [{ businessId, staffId: row!.id, weekday, startTime: minToTime(w.start), endTime: minToTime(w.end), locationId: multi ? locIds[siteOn(weekday)]! : null }] : [];
      });
      await tx.insert(schema.staffSchedules).values(schedRows);
      const mine = serviceIds.filter((sv) => s.skills.includes(sv.group) || s.skills.includes(sv.root));
      if (mine.length) await tx.insert(schema.staffServices).values(mine.map((sv) => ({ businessId, staffId: row!.id, serviceId: sv.id })));
      staffRows.push({ id: row!.id, name: s.name, skills: s.skills, hours: s.hours, homeSite, siteByDay, hourly: s.payType !== "commission", frontDesk: !!s.frontDesk, locationId: staffLoc });
    }

    // ---- Things that must be known before appointments are generated: time off, classes, standing visits ----
    const byName = (n: string) => staffRows.find((r) => r.name === n)!;
    const svcNamed = (n: string) => serviceIds.find((x) => x.name === n)!;
    const overrides = new Map<string, { isOff: boolean; start?: string; end?: string }>(); // `${staffId}:${day}`
    const busy = new Map<string, [number, number][]>(); // `${staffId}:${day}` -> minutes already taken (classes, standing visits, blocks)
    const reserve = (staffId: string, day: string, start: number, end: number) => { const k = `${staffId}:${day}`; busy.set(k, [...(busy.get(k) ?? []), [start, end]]); };
    const siteOnDay = (p: StaffRow, weekday: number) => p.siteByDay[weekday] ?? p.homeSite;
    /** Someone's working window on a day, after time off and custom hours; null when they are not in. */
    const workWindow = (p: StaffRow, day: string, weekday: number) => {
      const ov = overrides.get(`${p.id}:${day}`);
      if (ov?.isOff) return null;
      const siteIdx = siteOnDay(p, weekday);
      const base = baseWindow(p.hours, siteIdx, weekday);
      if (!base) return null;
      const start = ov?.start ? toMin(ov.start) : base.start;
      const end = ov?.end ? toMin(ov.end) : base.end;
      return end - start >= 90 ? { start, end, locationId: locIds[siteIdx]! } : null;
    };
    /** First start at or after `from` where `length` minutes fit between the day's reservations. */
    const clearOfBusy = (staffId: string, day: string, from: number, length: number) => {
      let t = from;
      for (let guard = 0; guard < 12; guard++) {
        const hit = (busy.get(`${staffId}:${day}`) ?? []).find(([a, b]) => t < b && t + length > a);
        if (!hit) break;
        t = hit[1] + 15;
      }
      return t;
    };

    // Group classes: the academy courses run on a Saturday, a Friday, and one was held a few weeks ago.
    const classPlan = [
      { staff: "Ava Martinez", service: "Classic Lash Foundations", offset: dowOffset(6, 9), start: "09:00", enrol: 5 },
      { staff: "Ava Martinez", service: "Volume Lash Masterclass", offset: dowOffset(6, 24), start: "09:00", enrol: 2 },
      { staff: "Sofia Rossi", service: "Korean ECO Lash Lift Certification", offset: dowOffset(5, 7), start: "10:00", enrol: 3 },
      { staff: "Ava Martinez", service: "Classic Lash Foundations", offset: dowOffset(6, -40), start: "09:00", enrol: 4 },
    ];
    for (const c of classPlan) {
      const sv = svcNamed(c.service);
      reserve(byName(c.staff).id, addDays(today, c.offset), toMin(c.start), toMin(c.start) + sv.min + sv.gap + sv.finish);
    }
    // Standing appointments (every N weeks), created through the app's own code after the main data exists.
    const seriesPlan = [
      { staff: "Ava Martinez", service: "Classic 3 Week Fill", client: 26, offset: dowOffset(2, 6), start: "10:00", every: 3, times: 6 },
      { staff: "Jordan Lee", service: "Volume 2 Week Fill", client: 27, offset: dowOffset(5, 7), start: "11:00", every: 2, times: 8 },
      { staff: "Priya Nair", service: "Korean Skin Science Facial", client: 28, offset: dowOffset(2, 7), start: "14:00", every: 4, times: 5 },
    ];
    for (const sp of seriesPlan) {
      const sv = svcNamed(sp.service);
      for (let i = 0; i < sp.times; i++) reserve(byName(sp.staff).id, addDays(today, sp.offset + i * sp.every * 7), toMin(sp.start) - 15, toMin(sp.start) + sv.min + sv.gap + sv.finish + 15);
    }
    post.classPlan = classPlan.map((c) => ({ ...c, staffId: byName(c.staff).id, serviceId: svcNamed(c.service).id, minutes: svcNamed(c.service).min + svcNamed(c.service).gap + svcNamed(c.service).finish, price: svcNamed(c.service).price, capacity: svcNamed(c.service).capacity }));
    post.seriesPlan = seriesPlan.map((sp) => ({ ...sp, staffId: byName(sp.staff).id, serviceId: svcNamed(sp.service).id, locationId: locIds[siteOnDay(byName(sp.staff), dowOf(addDays(today, sp.offset)))]! }));

    // Time off: a week's vacation, single days, a late start and an early finish, all inside the next 90 days (one in the past).
    const planOff: { who: string; from: number; span: number; note: string; hours?: [string, string]; working?: boolean }[] = [
      { who: "Ava Martinez", from: 17, span: 7, note: "Vacation" },
      { who: "Jordan Lee", from: 5, span: 1, note: "Dentist appointment", working: true },
      { who: "Jordan Lee", from: 9, span: 1, note: "Leaving early", hours: ["10:00", "14:00"], working: true },
      { who: "Priya Nair", from: 11, span: 1, note: "Training day", working: true },
      { who: "Sofia Rossi", from: 3, span: 1, note: "Late start", hours: ["12:00", "17:00"], working: true },
      { who: "Sofia Rossi", from: 38, span: 5, note: "Vacation" },
      { who: "Mina Park", from: -12, span: 1, note: "Sick day", working: true },
      { who: "Mina Park", from: 24, span: 2, note: "Industry conference" },
    ];
    for (const t of planOff) {
      const p = byName(t.who);
      let o = t.from;
      if (t.working) {
        const taken = (off: number) => { const d = addDays(today, off); return !workWindow(p, d, dowOf(d)) || busy.has(`${p.id}:${d}`) || overrides.has(`${p.id}:${d}`); };
        while (taken(o)) o++;
      }
      for (let k = 0; k < t.span; k++) {
        const date = addDays(today, o + k);
        overrides.set(`${p.id}:${date}`, t.hours ? { isOff: false, start: t.hours[0], end: t.hours[1] } : { isOff: true });
        await tx.insert(schema.staffScheduleOverrides).values({ businessId, staffId: p.id, date, isOff: !t.hours, startTime: t.hours?.[0] ?? null, endTime: t.hours?.[1] ?? null, note: t.note });
      }
    }

    // --- Clients
    const clientIds: { id: string; first: string; last: string }[] = [];
    for (let i = 0; i < 40; i++) {
      const first = FIRST[i % FIRST.length]!;
      const last = LAST[(i * 7) % LAST.length]!;
      const createdAt = new Date(Date.now() - between(10, 400) * 86_400_000);
      const [c] = await tx.insert(schema.clients).values({
        businessId, firstName: first, lastName: last, email: chance(0.85) ? `${first.toLowerCase()}.${last.toLowerCase()}@example.com` : null, phone: `+1703555${String(1000 + i).padStart(4, "0")}`,
        birthday: chance(0.6) ? `${between(1970, 2002)}-${String(between(1, 12)).padStart(2, "0")}-${String(between(1, 28)).padStart(2, "0")}` : null,
        tags: chance(0.3) ? [pick(["VIP", "Lash member", "Referred", "Bridal"])] : [], notes: chance(0.25) ? pick(["Sensitive eyes; use the sensitive adhesive.", "Prefers quiet appointments.", "Always books with Ava.", "Allergic to lanolin; check products."]) : null,
        referralCode: `${PROFILE.giftPrefix}${String(100 + i)}`, createdAt, homeLocationId: locIds[i % locIds.length]!,
      }).returning({ id: schema.clients.id });
      clientIds.push({ id: c!.id, first, last });
    }
    post.clientIds = clientIds;

    // --- Appointments: 8 weeks of history + 3 weeks ahead, per provider per working day
    const providers = staffRows.filter((s) => !s.frontDesk);
    const bookable = serviceIds.filter((s) => s.capacity === 1);
    let completed = 0, upcoming = 0, salesN = 0, reviewsN = 0;
    const reviewClients = new Set<string>();
    for (let offset = -56; offset <= 21; offset++) {
      const day = addDays(today, offset);
      const weekday = new Date(`${day}T00:00:00Z`).getUTCDay();
      if (weekday === 0) continue;
      const past = offset < 0;
      for (const p of providers) {
        const win = workWindow(p, day, weekday);
        if (!win) continue;
        const mine = bookable.filter((s) => p.skills.includes(s.group) || p.skills.includes(s.root));
        if (!mine.length) continue;
        let cursorMin = win.start + pick([0, 15, 30, 45]);
        const endOfDay = win.end;
        // Now and then someone blocks time out of their day (lunch, a meeting, a delivery).
        if (!past && chance(0.15)) {
          const length = pick([45, 60, 90]);
          const at = clearOfBusy(p.id, day, win.start + 60 + 15 * between(0, 8), length);
          if (at + length <= win.end) {
            const reason = pick(["Lunch", "Team meeting", "Supplier delivery", "Admin time", "Training video"]);
            const [blk] = await tx.insert(schema.appointments).values({ businessId, locationId: win.locationId, clientId: null, kind: "block", notes: reason, source: "staff", createdByUserId: user!.id }).returning({ id: schema.appointments.id });
            await tx.insert(schema.appointmentItems).values({ businessId, appointmentId: blk!.id, staffId: p.id, serviceId: null, serviceName: `Blocked · ${reason}`, startAt: zonedToInstant(day, minToTime(at), TZ), endAt: zonedToInstant(day, minToTime(at + length), TZ), priceCents: 0, sortOrder: 0 });
            reserve(p.id, day, at, at + length);
          }
        }
        const perDay = past ? between(3, 5) : offset === 0 ? between(2, 4) : between(1, 3);
        for (let n = 0; n < perDay && cursorMin < endOfDay - 60; n++) {
          const svc = pick(mine);
          const client = pick(clientIds);
          const len = svc.min + svc.gap + svc.finish;
          cursorMin = clearOfBusy(p.id, day, cursorMin, len);
          if (cursorMin + len > endOfDay) break;
          const startAt = zonedToInstant(day, `${String(Math.floor(cursorMin / 60)).padStart(2, "0")}:${String(cursorMin % 60).padStart(2, "0")}`, TZ);
          const total = svc.min + svc.gap + svc.finish;
          const endAt = new Date(startAt.getTime() + total * 60_000);
          const status = past ? (chance(0.9) ? "completed" : chance(0.5) ? "no_show" : "cancelled") : chance(0.5) ? "confirmed" : "booked";
          const [appt] = await tx.insert(schema.appointments).values({ businessId, locationId: win.locationId, clientId: client.id, status, source: chance(0.6) ? "online" : "staff", createdAt: new Date(startAt.getTime() - between(1, 20) * 86_400_000), cancelledAt: status === "cancelled" ? new Date(startAt.getTime() - 86_400_000 * 2) : null, notes: chance(0.15) ? pick(["Wants to go a shade lighter", "Running 5 min late last time", "Bring inspiration photos"]) : null }).returning({ id: schema.appointments.id });
          const [item] = await tx.insert(schema.appointmentItems).values({ businessId, appointmentId: appt!.id, staffId: p.id, serviceId: svc.id, serviceName: svc.name, startAt, endAt, priceCents: svc.price, status, allowOverlap: true }).returning({ id: schema.appointmentItems.id });
          cursorMin += total + pick([10, 15, 30, 45, 60]);
          if (!past) { upcoming++; continue; }
          if (status !== "completed") continue;
          completed++;
          // Sale: service line, optional retail line, tip, one payment
          const tipPct = chance(0.65) ? pick([15, 18, 20, 25]) : 0;
          const tip = Math.round((svc.price * tipPct) / 100);
          const retail = chance(0.2) ? pick(PRODUCTS) : null;
          const subtotal = svc.price + (retail?.price ?? 0);
          const tax = Math.round(((retail?.price ?? 0) * 600) / 10_000);
          const totalCents = subtotal + tax + tip;
          const numRows = await tx.execute<{ n: number }>(sql`select next_sale_number(${businessId}) as n`);
          const number = Number(numRows[0]!.n);
          const closedAt = new Date(endAt.getTime() + 5 * 60_000);
          const [sale] = await tx.insert(schema.sales).values({ businessId, number, appointmentId: appt!.id, locationId: win.locationId, clientId: client.id, status: "paid", subtotalCents: subtotal, taxCents: tax, tipCents: tip, totalCents, paidCents: totalCents, closedAt, createdAt: closedAt, createdByUserId: user!.id }).returning({ id: schema.sales.id });
          await tx.insert(schema.saleLines).values({ businessId, saleId: sale!.id, kind: "service", staffId: p.id, serviceId: svc.id, appointmentItemId: item!.id, name: svc.name, quantity: 1, unitCents: svc.price, amountCents: svc.price, taxable: false, sortOrder: 0 });
          if (retail) await tx.insert(schema.saleLines).values({ businessId, saleId: sale!.id, kind: "product", staffId: p.id, name: retail.name, quantity: 1, unitCents: retail.price, amountCents: retail.price, taxable: true, sortOrder: 1 });
          if (tip) await tx.insert(schema.saleLines).values({ businessId, saleId: sale!.id, kind: "tip", staffId: p.id, name: "Tip", quantity: 1, unitCents: tip, amountCents: tip, taxable: false, sortOrder: 2 });
          const card = chance(0.7);
          await tx.insert(schema.payments).values({ businessId, saleId: sale!.id, method: card ? "card" : "cash", status: "succeeded", amountCents: totalCents, tipCents: tip, cardBrand: card ? pick(["visa", "mastercard", "amex"]) : null, cardLast4: card ? String(between(1000, 9999)) : null, createdAt: closedAt, createdByUserId: user!.id });
          salesN++;
          if (chance(0.3)) {
            const rating = chance(0.8) ? 5 : chance(0.7) ? 4 : 3;
            await tx.insert(schema.reviews).values({ businessId, clientId: client.id, appointmentId: appt!.id, staffId: p.id, locationId: win.locationId, rating, comment: chance(0.7) ? pick(COMMENTS) : null, requestedAt: closedAt, submittedAt: new Date(closedAt.getTime() + between(2, 30) * 3_600_000), createdAt: closedAt });
            reviewsN++;
            reviewClients.add(client.id);
          }
          if (chance(0.5)) await tx.insert(schema.loyaltyLedger).values({ businessId, clientId: client.id, delta: Math.round(subtotal / 100), reason: "earn", saleId: sale!.id, createdAt: closedAt });
        }
      }
    }
    console.log(`Appointments: ${completed} completed, ${upcoming} upcoming; ${salesN} sales; ${reviewsN} reviews`);

    // --- Time clock for hourly / salaried staff (last 3 weeks)
    for (const p of staffRows.filter((s) => s.hourly)) {
      for (let offset = -21; offset < 0; offset++) {
        const day = addDays(today, offset);
        const weekday = new Date(`${day}T00:00:00Z`).getUTCDay();
        const win = workWindow(p, day, weekday);
        if (!win) continue;
        const start = zonedToInstant(day, minToTime(win.start - 8), TZ);
        const minutes = Math.max(240, win.end - win.start + between(-15, 20));
        await tx.insert(schema.timeEntries).values({ businessId, staffId: p.id, date: day, minutes, locationId: win.locationId, clockInAt: start, clockOutAt: new Date(start.getTime() + minutes * 60_000) });
      }
    }

    // --- Products
    const prodCats = new Map<string, string>();
    let pc = 0;
    for (const name of [...new Set(PRODUCTS.map((p) => p.cat))]) {
      const [row] = await tx.insert(schema.productCategories).values({ businessId, name, sortOrder: pc++ }).returning({ id: schema.productCategories.id });
      prodCats.set(name, row!.id);
    }
    // --- Inventory: suppliers, products (some sold in options, some back-bar) with a believable history, orders, and what services use up
    const supplierRows = await tx.insert(schema.suppliers).values([
      { businessId, name: "Luxe Lash Supply", contactName: "Marta Alvarez", email: "orders@luxelashsupply.example", phone: "(555) 010-2211", accountNumber: "LLS-20418", notes: "Free shipping over $250. Orders by Thursday ship Friday." },
      { businessId, name: "Pure Skin Distributors", contactName: "Dan Whitfield", email: "sales@pureskin.example", phone: "(555) 010-3377", accountNumber: "PSD-9921" },
      { businessId, name: "Salon Essentials Wholesale", contactName: "Front desk", email: "hello@salonessentials.example", phone: "(555) 010-4488" },
    ]).returning();
    const supplierId = (n: string) => supplierRows.find((r) => r.name === n)!.id;
    const siteQty = (q: number) => (multi ? [Math.ceil(q * 0.6), q - Math.ceil(q * 0.6)] : [q]);
    const pRows: { id: string; spec: SeedProduct }[] = [];
    const daysBack = (n: number) => new Date(Date.now() - n * 86_400_000);
    for (const [i, p] of PRODUCTS.entries()) {
      const finals = siteQty(p.qty);
      let imageUrl: string | null = null;
      if (!p.backbar) {
        const art = Buffer.from(productArt(p.name, i), "utf8");
        const [file] = await db.insert(schema.files).values({ businessId, kind: "product", contentType: "image/svg+xml", size: art.length, data: art }).returning({ id: schema.files.id });
        imageUrl = appUrl(`/api/files/${file!.id}`);
      }
      if (!prodCats.has(p.cat)) {
        const [row] = await tx.insert(schema.productCategories).values({ businessId, name: p.cat, sortOrder: prodCats.size }).returning({ id: schema.productCategories.id });
        prodCats.set(p.cat, row!.id);
      }
      const [row] = await tx.insert(schema.products).values({
        businessId, categoryId: prodCats.get(p.cat)!, name: p.name, variantLabel: p.label ?? null, kind: p.backbar ? "backbar" : "retail",
        sku: `${p.backbar ? "BB" : "LX"}-${String(100 + i)}`, barcode: `8801234${String(10000 + i * 37).padStart(6, "0")}`.slice(0, 13), priceCents: p.price, costCents: p.cost, taxable: true, sellOnline: !p.backbar, trackStock: true, stockQty: p.qty,
        lowStockThreshold: p.low, reorderUpTo: p.upTo ?? null, supplierId: supplierId(p.supplier), description: p.backbar ? null : "Salon-grade, recommended by our team.", imageUrl,
      }).returning({ id: schema.products.id });
      pRows.push({ id: row!.id, spec: p });
      for (const [li, q] of finals.entries()) if (q !== 0) await tx.insert(schema.productStock).values({ businessId, productId: row!.id, locationId: locIds[li]!, qty: q });
      // History: sold/used in small amounts over the last 85 days, write-offs, a delivery, and an opening count sized so today's number comes out right.
      type Mv = { delta: number; reason: string; daysAgo: number; li: number; note?: string; po?: 1 | 3 };
      const mvs: Mv[] = [];
      let left = p.sold;
      while (left > 0) {
        const n = Math.min(left, between(1, p.backbar ? 6 : 3));
        mvs.push({ delta: -n, reason: p.backbar ? "used" : "sale", daysAgo: between(1, 85), li: multi && chance(0.4) ? 1 : 0, note: p.backbar ? "Used in services" : undefined });
        left -= n;
      }
      if (p.written) mvs.push({ delta: -p.written[1], reason: p.written[0], daysAgo: between(8, 40), li: 0, note: p.written[0] === "expired" ? "Past its date" : p.written[0] === "damage" ? "Dropped, leaked" : "Missing after a busy Saturday" });
      if (p.recv) mvs.push({ delta: p.recv.qty, reason: "received", daysAgo: p.recv.daysAgo, li: 0, note: "Order", po: p.recv.po });
      const perLoc = finals.map((fin, li) => ({ li, opening: fin - mvs.filter((m) => m.li === li).reduce((a, m) => a + m.delta, 0) }));
      for (const { li, opening } of perLoc) if (opening !== 0) mvs.push({ delta: opening, reason: "opening", daysAgo: 90, li, note: "Opening stock" });
      await tx.insert(schema.stockMovements).values(mvs.map((m) => ({ businessId, productId: row!.id, locationId: locIds[m.li]!, delta: m.delta, reason: m.reason, note: m.note ?? null, createdByUserId: user!.id, createdAt: daysBack(m.daysAgo) })));
    }
    // Orders to suppliers: one received a month ago, one partly received, one on its way, one drafted from the reorder list.
    const prod = (n: string, label?: string) => pRows.find((r) => r.spec.name === n && (r.spec.label ?? null) === (label ?? null))!;
    const orderPlan: { number: number; supplier: string; status: "received" | "partial" | "ordered" | "draft"; orderedAgo: number | null; receivedAgo?: number; expectedIn?: number; reference?: string; lines: [ReturnType<typeof prod>, number, number][] }[] = [
      { number: 1, supplier: "Luxe Lash Supply", status: "received", orderedAgo: 34, receivedAgo: 30, reference: "INV-55102", lines: [[prod("Lash Cleanser Foam", "50 ml"), 24, 24], [prod("Classic lash trays", "0.15"), 20, 20]] },
      { number: 2, supplier: "Pure Skin Distributors", status: "partial", orderedAgo: 12, expectedIn: 2, reference: "SO-77881", lines: [[prod("Daily SPF 50", "100 ml"), 12, 6], [prod("Vitamin C Serum"), 10, 0]] },
      { number: 3, supplier: "Luxe Lash Supply", status: "ordered", orderedAgo: 2, expectedIn: 3, lines: [[prod("Lash Sealant"), 18, 0], [prod("Lash Growth Serum"), 8, 0], [prod("Volume lash trays", "0.07"), 12, 0], [prod("Lash Adhesive (pro)"), 6, 0]] },
      { number: 4, supplier: "Salon Essentials Wholesale", status: "draft", orderedAgo: null, lines: [[prod("Eye gel patches (pair)"), 300, 0], [prod("Disposable applicators"), 150, 0]] },
    ];
    for (const o of orderPlan) {
      const [po] = await tx.insert(schema.purchaseOrders).values({ businessId, number: o.number, supplierId: supplierId(o.supplier), locationId, status: o.status, orderedAt: o.orderedAgo != null ? daysBack(o.orderedAgo) : null, receivedAt: o.receivedAgo != null ? daysBack(o.receivedAgo) : null, expectedOn: o.expectedIn != null ? addDays(today, o.expectedIn) : null, reference: o.reference ?? null, createdByUserId: user!.id, createdAt: daysBack(o.orderedAgo ?? 1) }).returning({ id: schema.purchaseOrders.id });
      await tx.insert(schema.purchaseOrderLines).values(o.lines.map(([p, ordered, received]) => ({ businessId, purchaseOrderId: po!.id, productId: p.id, orderedQty: ordered, receivedQty: received, unitCostCents: p.spec.cost })));
      // Link the history rows for deliveries to their order.
      if (o.status === "received" || o.status === "partial") for (const [p] of o.lines) await tx.update(schema.stockMovements).set({ purchaseOrderId: po!.id, note: `Order #${o.number}` }).where(and(eq(schema.stockMovements.productId, p.id), eq(schema.stockMovements.reason, "received")));
    }
    // What services use up.
    for (const u of USAGE) {
      for (const sv of serviceIds.filter((x) => u.match.test(`${x.name} ${x.group}`))) {
        for (const [pn, q, mode] of u.uses) {
          const hit = pRows.find((r) => r.spec.name === pn || `${r.spec.name}${r.spec.label ? ` ${r.spec.label}` : ""}` === pn);
          if (hit) await tx.insert(schema.serviceProducts).values({ businessId, serviceId: sv.id, productId: hit.id, quantity: q, mode }).onConflictDoNothing();
        }
      }
    }
    console.log(`Inventory: ${PRODUCTS.length} products, ${supplierRows.length} suppliers, ${orderPlan.length} orders`);

    // --- Forms
    const colour = colourIds;
    const formRows = await tx.insert(schema.forms).values([
      { businessId, name: "New client intake", kind: "intake", description: "Helps us personalise your visit.", applyToAll: true, requireSignature: false, renewDays: 365, fields: [
        { id: "f1", type: "text", label: "How did you hear about us?", required: false },
        { id: "f2", type: "multiselect", label: "Any of the following?", options: ["Sensitive skin", "Allergies to hair colour", "Pregnant or nursing", "Recent chemical treatment"] },
        { id: "f3", type: "textarea", label: "Anything else we should know?" },
        { id: "f4", type: "checkbox", label: "I'd like to receive occasional offers by text" },
      ] },
      { businessId, name: "Permanent makeup consent", kind: "consent", description: "Please read and sign before your permanent makeup appointment.", serviceIds: colour, requireSignature: true, renewDays: 365, fields: [
        { id: "c1", type: "statement", label: "Permanent makeup is a cosmetic tattoo. Results vary with skin type and aftercare; colour softens as it heals and a touch-up may be needed. Not suitable during pregnancy or with certain skin conditions." },
        { id: "c2", type: "checkbox", label: "I have disclosed medications, allergies and skin conditions", required: true },
        { id: "c3", type: "checkbox", label: "I understand healed results may differ from the fresh result and that touch-ups are charged separately", required: true },
      ] },
    ]).returning();

    // --- Packages, memberships, gift cards, promo, waitlist, automations
    const blowout = serviceIds.find((s) => s.name === "Glow Facial")!;
    const facial = serviceIds.find((s) => s.name === "Korean Skin Science Facial")!;
    const gel = serviceIds.find((s) => s.name === "Classic 2 Week Fill")!;
    const pkgRows: { id: string; name: string; serviceId: string; sessions: number }[] = [];
    for (const pk of [
      { name: "Signature Glow & Lift (3 facials)", serviceId: blowout.id, sessions: 3, priceCents: 45000, validDays: 180 },
      { name: "Radiant Glow & Booster (6 facials)", serviceId: facial.id, sessions: 6, priceCents: 80000, validDays: 365 },
    ]) {
      const imageUrl = await photo(businessId, "package", PACKAGE_PHOTOS[pk.name], pk.name, "💆", 3);
      const [pkRow] = await tx.insert(schema.packages).values({ businessId, ...pk, description: PACKAGE_BLURBS[pk.name] ?? null, imageUrl }).returning({ id: schema.packages.id });
      pkgRows.push({ id: pkRow!.id, name: pk.name, serviceId: pk.serviceId, sessions: pk.sessions });
    }
    const planRows = await tx.insert(schema.membershipPlans).values([
      { businessId, name: "Classic Lash Membership", priceCents: 11000, includedServiceId: gel.id, includedSessions: 2, discountBps: 0, description: "Two classic refills a month ($55 each instead of $65)." },
      { businessId, name: "Lash Lift & Tint Membership", priceCents: 9000, includedServiceId: serviceIds.find((s) => s.name === "Korean Lash Lift (ECO) & Tint")!.id, includedSessions: 1, discountBps: 500, description: "One lash lift & tint a month and 5% off retail." },
      { businessId, name: "Fill Club", priceCents: 5500, interval: "week", intervalCount: 2, includedServiceId: gel.id, includedSessions: 1, rolloverCap: 1, discountBps: 0, description: "A refill every two weeks; skip one and it carries over." },
      { businessId, name: "Glow Year", priceCents: 99000, interval: "year", intervalCount: 1, includedServiceId: blowout.id, includedSessions: 12, discountBps: 1000, description: "Twelve facials a year and 10% off everything else." },
      { businessId, name: "12-Week Lash Course", priceCents: 6000, interval: "week", intervalCount: 2, cycleCount: 6, includedServiceId: gel.id, includedSessions: 1, discountBps: 0, description: "Six fills over twelve weeks, then it ends on its own." },
    ]).returning({ id: schema.membershipPlans.id, name: schema.membershipPlans.name });
    for (const [i, c] of clientIds.slice(0, 3).entries()) await tx.insert(schema.giftCards).values({ businessId, code: `${PROFILE.giftPrefix}-GIFT-${1000 + i}`, initialCents: 10000, balanceCents: i === 0 ? 4500 : 10000, purchaserClientId: c.id, recipientName: `${c.first}'s friend`, locationId });
    await tx.insert(schema.promoCodes).values({ businessId, code: "WELCOME10", type: "percent", value: 10, maxUses: 100 });
    // --- Waitlist: a few open requests for coming days, one already booked and one closed
    const wl = (n: number) => clientIds[n]!.id;
    const ava = byName("Ava Martinez"), priya = byName("Priya Nair"), sofia = byName("Sofia Rossi");
    const agoDays = (n: number) => new Date(Date.now() - n * 86_400_000);
    await tx.insert(schema.waitlist).values([
      { businessId, clientId: wl(5), serviceId: svcNamed("Volume Full Set").id, staffId: ava.id, locationId: ava.locationId, date: addDays(today, 3), notes: "Any time after 2pm", createdAt: agoDays(2) },
      { businessId, clientId: wl(9), serviceId: gel.id, locationId: locIds[locIds.length - 1]!, date: addDays(today, 1), notes: "Lunchtime if possible", createdAt: agoDays(1) },
      { businessId, clientId: wl(14), serviceId: facial.id, staffId: priya.id, locationId: priya.locationId, date: addDays(today, 6), notes: "Mondays or Fridays only (she works nearby)", createdAt: agoDays(4) },
      { businessId, clientId: wl(17), serviceId: serviceIds.find((x) => x.root === "Brow Lamination & Tint")!.id, staffId: sofia.id, locationId: sofia.locationId, date: addDays(today, 9), notes: "Wants Sofia specifically", createdAt: agoDays(3) },
      { businessId, clientId: wl(21), serviceId: blowout.id, locationId: priya.locationId, date: addDays(today, 12), notes: "Saturday morning", createdAt: agoDays(6) },
      { businessId, clientId: wl(3), serviceId: gel.id, staffId: ava.id, locationId: ava.locationId, date: addDays(today, -3), notes: "Booked into a cancelled slot", status: "booked" as const, createdAt: agoDays(9) },
      { businessId, clientId: wl(11), serviceId: facial.id, locationId: priya.locationId, date: addDays(today, -6), notes: "Found a time elsewhere", status: "closed" as const, createdAt: agoDays(12) },
    ]);

    // --- Referrals: a few friends brought in by existing clients; most already rewarded
    const refPairs: [number, number, boolean][] = [[0, 6, true], [0, 7, true], [2, 8, true], [3, 9, true], [4, 10, false], [5, 11, false]];
    for (const [i, [from, to, rewarded]] of refPairs.entries()) {
      const when = agoDays([40, 30, 22, 15, 9, 3][i]!); // joined; rewarded nine days later (the newest two are still waiting for a first visit)
      await tx.update(schema.clients).set({ createdAt: agoDays(300 - i * 10) }).where(eq(schema.clients.id, clientIds[from]!.id));
      await tx.update(schema.clients).set({ referredByClientId: clientIds[from]!.id, createdAt: when, referralRewardedAt: rewarded ? new Date(when.getTime() + 9 * 86_400_000) : null }).where(eq(schema.clients.id, clientIds[to]!.id));
      if (rewarded) {
        const at = new Date(when.getTime() + 9 * 86_400_000);
        await tx.insert(schema.loyaltyLedger).values([
          { businessId, clientId: clientIds[from]!.id, delta: 500, reason: "referral", createdAt: at },
          { businessId, clientId: clientIds[to]!.id, delta: 250, reason: "referral_friend", createdAt: at },
        ]);
      }
    }

    // --- Client notes: formulas, preferences and warnings, a few pinned
    const NOTES: [number, string, boolean][] = [
      [0, "Formula: 7N + 8.1 equal parts, 20 vol, 35 min. Root touch-up every five weeks.", true],
      [1, "Prefers a quiet appointment, no small talk.", true],
      [2, "Sensitive eyes: use the sensitive adhesive and tape.", true],
      [3, "Bridal client. Trial done, wants a soft natural set for the day.", false],
      [4, "Allergic to latex: use nitrile gloves.", true],
      [5, "Likes the C curl, 12 mm centre, 10 mm outer. Never longer.", false],
      [6, "Referred by a friend. Mentioned a birthday coming up.", false],
      [7, "Runs late on Mondays because of school pickup. Book later slots.", false],
      [8, "Brow shape: soft arch, keep the tail long. Tint 2 parts dark brown to 1 part black.", true],
      [9, "Has asked about the lash membership twice.", false],
      [10, "Patch test done, no reaction. Cleared for lash lift.", false],
      [11, "Pays with the card on file; tips cash.", false],
    ];
    for (const [i, [c, body, pinned]] of NOTES.entries()) await tx.insert(schema.clientNotes).values({ businessId, clientId: clientIds[c]!.id, authorUserId: user!.id, body, pinned, createdAt: agoDays(70 - i * 5) });

    // --- Memberships (active, paused, ended, cancelled) and package balances
    const plan = (name: string) => planRows.find((r) => r.name === name)!.id;
    const inDays = (n: number) => new Date(Date.now() + n * 86_400_000);
    const MEMBERS: { c: number; plan: string; status?: "active" | "paused" | "cancelled" | "ended"; end: number; credits: number; cycles: number; auto: boolean; started: number; frozen?: [number, number]; cancelled?: number }[] = [
      { c: 12, plan: "Classic Lash Membership", end: 12, credits: 1, cycles: 4, auto: true, started: 110 },
      { c: 13, plan: "Classic Lash Membership", end: 3, credits: 2, cycles: 2, auto: true, started: 40 },
      { c: 14, plan: "Classic Lash Membership", end: 25, credits: 2, cycles: 1, auto: false, started: 5 },
      { c: 15, plan: "Lash Lift & Tint Membership", end: 9, credits: 1, cycles: 6, auto: true, started: 170 },
      { c: 16, plan: "Fill Club", end: 5, credits: 1, cycles: 9, auto: true, started: 130 },
      { c: 17, plan: "Fill Club", status: "paused", end: 21, credits: 1, cycles: 5, auto: true, started: 80, frozen: [6, -8] },
      { c: 18, plan: "Glow Year", end: 260, credits: 9, cycles: 1, auto: false, started: 105 },
      { c: 19, plan: "12-Week Lash Course", end: 9, credits: 1, cycles: 3, auto: true, started: 40 },
      { c: 20, plan: "12-Week Lash Course", status: "ended", end: -20, credits: 0, cycles: 6, auto: false, started: 100 },
      { c: 21, plan: "Classic Lash Membership", status: "cancelled", end: -5, credits: 0, cycles: 3, auto: false, started: 120, cancelled: 14 },
    ];
    for (const m of MEMBERS) {
      await tx.insert(schema.clientMemberships).values({
        businessId, clientId: clientIds[m.c]!.id, planId: plan(m.plan), status: m.status ?? "active", startedAt: agoDays(m.started), currentPeriodEnd: inDays(m.end), creditsRemaining: m.credits, cyclesBilled: m.cycles, autoRenew: m.auto,
        frozenAt: m.frozen ? agoDays(m.frozen[0]) : null, frozenUntil: m.frozen ? inDays(-m.frozen[1]) : null, cancelledAt: m.cancelled ? agoDays(m.cancelled) : null, locationId: locationId,
      });
    }
    const pkg = (name: string) => pkgRows.find((r) => r.name.startsWith(name))!;
    for (const [c, name, remaining, expiresIn] of [[22, "Signature Glow", 2, 120], [23, "Radiant Glow", 6, 300], [24, "Radiant Glow", 1, 18], [25, "Signature Glow", 3, 170]] as [number, string, number, number][]) {
      await tx.insert(schema.clientPackages).values({ businessId, clientId: clientIds[c]!.id, packageId: pkg(name).id, serviceId: pkg(name).serviceId, remaining, expiresAt: inDays(expiresIn), locationId });
    }

    // --- Forms completed by clients: intake for most, a signed consent for permanent makeup clients
    const intake = formRows.find((f) => f.kind === "intake")!;
    const consent = formRows.find((f) => f.kind === "consent")!;
    const snap = (f: typeof intake) => ({ name: f.name, fields: f.fields, description: f.description });
    for (let c = 0; c < 26; c++) {
      await tx.insert(schema.formSubmissions).values({ businessId, formId: intake.id, clientId: clientIds[c]!.id, answers: { f1: pick(["Instagram", "A friend", "Google", "Walked past", "Yelp"]), f2: chance(0.4) ? [pick(["Sensitive skin", "Allergies to hair colour", "Recent chemical treatment"])] : [], f3: chance(0.3) ? pick(["First time getting lashes.", "I get dry eyes by evening.", "Please no fragrance."]) : "", f4: chance(0.6) }, formSnapshot: snap(intake), signedAt: null, createdAt: agoDays(between(3, 90)) });
    }
    for (const c of [28, 29, 30, 31]) {
      const at = agoDays(between(5, 80));
      await tx.insert(schema.formSubmissions).values({ businessId, formId: consent.id, clientId: clientIds[c]!.id, answers: { c2: true, c3: true }, signatureName: `${clientIds[c]!.first} ${clientIds[c]!.last}`, signedAt: at, ipAddress: `203.0.113.${between(2, 250)}`, formSnapshot: snap(consent), createdAt: at });
    }

    // --- Campaigns (two sent, one draft) and a few texts from clients
    await tx.insert(schema.campaigns).values([
      { businessId, name: "We miss you: a refill on us", channel: "email", subject: "It has been a while", body: "Hi {{firstName}}, it has been a few weeks since your last visit. Book a refill this month and we will add a free lash cleanse.", audience: { lapsedDays: 45 }, status: "sent", recipientCount: 11, sentAt: agoDays(9), createdByUserId: user!.id },
      { businessId, name: "Lash lift refresh reminder", channel: "sms", body: "Hi {{firstName}}, your lash lift is due for a refresh. Reply or book online any time.", audience: { visitedWithinDays: 90 }, status: "sent", recipientCount: 14, sentAt: agoDays(26), createdByUserId: user!.id },
      { businessId, name: "New Korean facial menu", channel: "email", subject: "Meet our new facials", body: "We have added new Korean skin science facials. Book yours this week.", audience: {}, status: "draft", recipientCount: 0, createdByUserId: user!.id },
    ]);
    const hoursAgo = (n: number) => new Date(Date.now() - n * 3_600_000);
    const phoneOf = (i: number) => `+1703555${String(1000 + i).padStart(4, "0")}`;
    await tx.insert(schema.inboundMessages).values([
      { businessId, clientId: clientIds[3]!.id, fromNumber: phoneOf(3), toNumber: "+17035550142", body: "Running about 10 minutes late, so sorry!", receivedAt: hoursAgo(2), readAt: null },
      { businessId, clientId: clientIds[7]!.id, fromNumber: phoneOf(7), toNumber: "+17035550142", body: "Can I move my appointment to Friday afternoon?", receivedAt: hoursAgo(20), readAt: null },
      { businessId, clientId: clientIds[12]!.id, fromNumber: phoneOf(12), toNumber: "+17035550142", body: "Thank you! My lashes look amazing.", receivedAt: hoursAgo(50), readAt: hoursAgo(48) },
      { businessId, clientId: clientIds[18]!.id, fromNumber: phoneOf(18), toNumber: "+17035550142", body: "Do you have any openings next week for a facial?", receivedAt: hoursAgo(75), readAt: hoursAgo(70) },
    ]);

    // --- Group classes: sessions with enrolled clients (one already held)
    for (const [ci, c] of (post.classPlan ?? []).entries()) {
      const startAt = zonedToInstant(addDays(today, c.offset), c.start, TZ);
      const endAt = new Date(startAt.getTime() + c.minutes * 60_000);
      const staffLoc = locIds[(byName(c.staff).siteByDay[dowOf(addDays(today, c.offset))] ?? byName(c.staff).homeSite)]!;
      const [sess] = await tx.insert(schema.classSessions).values({ businessId, serviceId: c.serviceId, staffId: c.staffId, locationId: staffLoc, startAt, endAt, capacity: c.capacity, priceCents: c.price, notes: ci === 2 ? "Bring your own tweezers." : null, createdByUserId: user!.id }).returning({ id: schema.classSessions.id });
      for (let n = 0; n < c.enrol; n++) {
        const client = clientIds[30 + ((ci * 3 + n) % 10)]!;
        if (c.offset > 0) {
          await insertSeat(tx, { businessId, sessionId: sess!.id, clientId: client.id, notes: null, source: chance(0.5) ? "online" : "staff", createdByUserId: user!.id });
        } else {
          const [appt] = await tx.insert(schema.appointments).values({ businessId, locationId: staffLoc, clientId: client.id, status: "completed", source: "staff", createdByUserId: user!.id }).returning({ id: schema.appointments.id });
          await tx.insert(schema.appointmentItems).values({ businessId, appointmentId: appt!.id, staffId: c.staffId, serviceId: c.serviceId, serviceName: c.service, startAt, endAt, priceCents: c.price, status: "completed", classSessionId: sess!.id, allowOverlap: true });
        }
      }
    }
  });

  // Workflows: every template exists; turn on the ones a busy salon would use.
  const biz = (await db.query.businesses.findFirst({ where: eq(schema.businesses.id, businessId) }))!;
  await ensureTemplates(biz);
  await withTenant(businessId, (tx) => tx.update(schema.workflows).set({ enabled: true }).where(sql`${schema.workflows.templateKey} in ('reminder','review_request','rebook','no_show_follow_up','welcome','birthday','win_back','membership_save','low_rating_alert')`));

  // ---- Second phase: what the app's own functions create (they open their own transactions) ----
  const clients = post.clientIds!;
  // Standing appointments: every few weeks with the same person
  let seriesVisits = 0;
  for (const sp of post.seriesPlan ?? []) {
    try {
      const r = await createSeries({ businessId, timeZone: TZ, slotIntervalMin: biz.slotIntervalMin, clientId: clients[sp.client]!.id, serviceId: sp.serviceId, staffId: sp.staffId, firstStartAt: zonedToInstant(addDays(today, sp.offset), sp.start, TZ), intervalWeeks: sp.every, occurrences: sp.times, notes: null, createdByUserId: user!.id, locationId: sp.locationId });
      seriesVisits += r.created.length;
      for (const k of r.skipped) console.warn(`  standing visit skipped (${sp.service}): ${k.reason}`);
    } catch (e) { console.warn(`  standing appointment not created (${sp.service}): ${(e as Error).message}`); }
  }
  // Refunds, so reports show them: two to the card or cash, two to store credit
  const reasons = await listRefundReasons(businessId); // also creates the default list
  const reasonId = (name: string) => reasons.find((r) => r.name.toLowerCase().includes(name))?.id ?? reasons[0]?.id ?? null;
  const pays = await withTenant(businessId, (tx) => tx.select({ id: schema.payments.id, amount: schema.payments.amountCents, clientId: schema.sales.clientId }).from(schema.payments).innerJoin(schema.sales, eq(schema.sales.id, schema.payments.saleId)).where(eq(schema.payments.status, "succeeded")).orderBy(desc(schema.sales.number)).limit(40));
  let refunded = 0;
  const tryRefund = async (label: string, fn: () => Promise<void>) => { try { await fn(); refunded++; } catch (e) { console.warn(`  refund skipped (${label}): ${(e as Error).message}`); } };
  if (pays[6]) await tryRefund("full", () => refundPayment({ businessId, accountId: null, paymentId: pays[6]!.id, amountCents: pays[6]!.amount, reason: "Client unhappy with the result", reasonId: reasonId("service"), actorUserId: user!.id, taxRateBps: 600 }));
  if (pays[15]) await tryRefund("partial", () => refundPayment({ businessId, accountId: null, paymentId: pays[15]!.id, amountCents: Math.round(pays[15]!.amount * 0.4), reason: "Goodwill adjustment", reasonId: reasonId("goodwill") ?? reasonId("other"), actorUserId: user!.id, taxRateBps: 600 }));
  if (pays[22]?.clientId) await tryRefund("credit 1", () => refundToStoreCredit({ businessId, paymentId: pays[22]!.id, amountCents: Math.min(4500, pays[22]!.amount), reason: "Moved to store credit", reasonId: reasonId("changed mind") ?? reasonId("other"), actorUserId: user!.id }));
  if (pays[30]?.clientId) await tryRefund("credit 2", () => refundToStoreCredit({ businessId, paymentId: pays[30]!.id, amountCents: Math.min(6500, pays[30]!.amount), reason: "Cancelled package", reasonId: reasonId("changed mind") ?? reasonId("other"), actorUserId: user!.id }));
  // Payroll: the two periods before the current default one (the last 14 days) are finalized; the current one stays open
  for (const end of [addDays(today, -29), addDays(today, -15)]) {
    try { await finalizePayroll(biz, { start: addDays(end, -13), end }, false, user!.id); } catch (e) { console.warn(`  payroll not finalized for ${end}: ${(e as Error).message}`); }
  }
  // Gallery: before and after photos on recent visits
  const photoPairs = await seedDemoPhotos(businessId, user!.id);
  console.log(`Extras: ${seriesVisits} standing visits, ${refunded} refunds, 2 payroll periods finalized, photos on ${photoPairs} visits`);

  console.log(`\nDone. Sign in at ${appUrl("/sign-in")}\n  email:    ${EMAIL}\n  password: ${PASSWORD}\n  business: ${appUrl(`/app/${SLUG}`)}\n  booking:  ${appUrl(`/book/${SLUG}`)}`);
  await pg.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
