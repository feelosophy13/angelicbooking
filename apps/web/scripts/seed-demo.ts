/**
 * Creates (or refreshes) a demo business with realistic fake data so the app can be
 * shown without touching a real tenant: nested service menu with images, staff on every
 * pay model, 40 clients, two months of completed visits with sales, tips and reviews,
 * upcoming bookings, products with stock, forms, packages, memberships, gift cards,
 * promo code, waitlist and automations.
 *
 * Usage (from apps/web, against whatever DATABASE_URL points at):
 *   ../../packages/db/node_modules/.bin/tsx --env-file=../../.env scripts/seed-demo.ts [--reset]
 *
 * Login: demo@angelicbooking.com / demo-salon-2026   Business slug: demo-salon
 * --reset deletes the demo business first (never any other tenant) and rebuilds it.
 */
import { and, eq, sql } from "drizzle-orm";
import { db, getSql, schema, withTenant, type TenantDb } from "@angelic/db";
import { zonedToInstant } from "@angelic/core";
import { auth } from "../src/lib/auth";
import { ensureTemplates } from "../src/server/workflows";
import { appUrl } from "../src/lib/stripe";

const EMAIL = "demo@angelicbooking.com";
const PASSWORD = "demo-salon-2026";
const SLUG = "demo-salon";
const NAME = "Luxe Beauty Studio";
const TZ = "America/New_York";
const RESET = process.argv.includes("--reset");

// Deterministic pseudo-random so re-runs look the same.
let seed = 20261010;
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
async function tile(businessId: string, kind: "category" | "service", label: string, emoji: string, i: number): Promise<string> {
  const [a, b] = PALETTES[i % PALETTES.length]!;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="500" height="300" viewBox="0 0 500 300"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient></defs><rect width="500" height="300" fill="url(#g)"/><circle cx="420" cy="60" r="90" fill="#fff" fill-opacity="0.12"/><circle cx="60" cy="260" r="70" fill="#fff" fill-opacity="0.1"/><text x="250" y="165" font-size="110" text-anchor="middle" dominant-baseline="middle">${emoji}</text><text x="250" y="262" font-family="system-ui, -apple-system, Segoe UI, sans-serif" font-size="22" font-weight="600" fill="#fff" fill-opacity="0.9" text-anchor="middle">${label.replace(/&/g, "&amp;")}</text></svg>`;
  const data = Buffer.from(svg, "utf8");
  const [row] = await db.insert(schema.files).values({ businessId, kind, contentType: "image/svg+xml", size: data.length, data }).returning({ id: schema.files.id });
  return appUrl(`/api/files/${row!.id}`);
}

// ---------------------------------------------------------------------------
// Menu
// ---------------------------------------------------------------------------
type Svc = { name: string; min: number; price: number; gap?: number; finish?: number; deposit?: number; desc?: string; emoji: string; capacity?: number; prep?: string };
type StaffDef = { name: string; email: string; color: string; position: string; payType: "commission" | "hourly" | "salary"; main?: number; product: number; hourly?: number; salary?: number; skills: string[]; days: number[]; frontDesk?: boolean };
type Cat = { name: string; emoji: string; desc: string; prep?: string; children?: Cat[]; services?: Svc[] };
const MENU: Cat[] = [
  { name: "Hair", emoji: "💇‍♀️", desc: "Cuts, colour and styling for every hair type.", children: [
    { name: "Cuts & Styling", emoji: "✂️", desc: "Precision cuts and finishing.", services: [
      { name: "Women's Haircut", min: 45, price: 6500, emoji: "✂️", desc: "Consultation, shampoo, cut and blow-dry." },
      { name: "Men's Haircut", min: 30, price: 3800, emoji: "💈" },
      { name: "Kids' Haircut (under 12)", min: 25, price: 2800, emoji: "🧒" },
      { name: "Blowout", min: 40, price: 4500, emoji: "💨", desc: "Wash and professional blow-dry." },
      { name: "Special Occasion Updo", min: 60, price: 9500, deposit: 2500, emoji: "👰" },
    ] },
    { name: "Colour", emoji: "🎨", desc: "From root touch-ups to full balayage.", prep: "Come with dry, unwashed hair (1–2 days) and no styling products. New to colour with us? A patch test 48 hours before is required.", services: [
      { name: "Root Touch-Up", min: 30, price: 7500, gap: 35, finish: 30, emoji: "🎯", desc: "Single-process colour on regrowth." },
      { name: "Full Colour", min: 45, price: 11000, gap: 40, finish: 30, emoji: "🌈" },
      { name: "Partial Highlights", min: 60, price: 14000, gap: 40, finish: 30, deposit: 3000, emoji: "✨" },
      { name: "Full Balayage", min: 90, price: 22000, gap: 45, finish: 45, deposit: 5000, emoji: "🌅", desc: "Hand-painted dimension, includes toner and blow-dry." },
      { name: "Gloss / Toner", min: 30, price: 5500, emoji: "💧" },
    ] },
    { name: "Treatments", emoji: "🧴", desc: "Repair, smooth and shine.", services: [
      { name: "Deep Conditioning Treatment", min: 30, price: 4000, emoji: "🧴" },
      { name: "Keratin Smoothing", min: 150, price: 28000, deposit: 7500, emoji: "💫", desc: "Frizz-free for up to 4 months.", prep: "Plan 3 hours and bring nothing in your hair: no clips, hats or products. You can't wash it for 72 hours afterwards." },
    ] },
  ] },
  { name: "Nails", emoji: "💅", desc: "Manicures and pedicures in a clean, calm space.", children: [
    { name: "Manicure", emoji: "💅", desc: "", services: [
      { name: "Classic Manicure", min: 30, price: 3000, emoji: "💅" },
      { name: "Gel Manicure", min: 45, price: 4500, emoji: "💎", desc: "Chip-free shine for two weeks." },
      { name: "Gel Removal", min: 15, price: 1500, emoji: "🧽" },
    ] },
    { name: "Pedicure", emoji: "🦶", desc: "", services: [
      { name: "Classic Pedicure", min: 45, price: 4500, emoji: "🦶" },
      { name: "Spa Pedicure", min: 60, price: 6500, emoji: "🛁", desc: "Scrub, mask and hot-stone massage." },
    ] },
  ] },
  { name: "Lashes & Brows", emoji: "👁️", desc: "Extensions, lifts and shaping.", services: [
    { name: "Classic Lash Full Set", min: 120, price: 18000, deposit: 5000, emoji: "👁️", prep: "Please come without mascara or eye make-up, and skip caffeine right before so you can lie still." },
    { name: "Lash Fill", min: 75, price: 8500, emoji: "🪄" },
    { name: "Lash Lift & Tint", min: 60, price: 9500, emoji: "🌙" },
    { name: "Brow Lamination", min: 45, price: 7000, emoji: "🪶" },
    { name: "Brow Shaping", min: 20, price: 2500, emoji: "✏️" },
  ] },
  { name: "Skin", emoji: "🧖‍♀️", desc: "Facials tailored to your skin.", prep: "Arrive make-up free and stop retinol or acids 3 days before.", services: [
    { name: "Signature Facial", min: 60, price: 11000, emoji: "🧖‍♀️", desc: "Cleanse, exfoliate, extractions, mask and massage." },
    { name: "Express Glow Facial", min: 30, price: 6500, emoji: "🌟" },
    { name: "Dermaplaning", min: 45, price: 9000, emoji: "🪒" },
    { name: "Lash Lift Class", min: 120, price: 24900, capacity: 6, emoji: "🎓", desc: "Small-group training with kit included." },
  ] },
  { name: "Massage", emoji: "💆‍♀️", desc: "Unwind with our licensed therapists.", services: [
    { name: "Swedish Massage · 60 min", min: 60, price: 9500, emoji: "💆‍♀️" },
    { name: "Deep Tissue · 60 min", min: 60, price: 11000, emoji: "🙌" },
    { name: "Deep Tissue · 90 min", min: 90, price: 15500, emoji: "🙌" },
  ] },
];

const STAFF: StaffDef[] = [
  { name: "Ava Martinez", email: "ava@luxebeauty.demo", color: "#db2777", position: "Senior Stylist", payType: "commission", main: 4500, product: 1000, skills: ["Cuts & Styling", "Colour", "Treatments"], days: [2, 3, 4, 5, 6] },
  { name: "Jordan Lee", email: "jordan@luxebeauty.demo", color: "#2563eb", position: "Stylist", payType: "hourly", hourly: 2200, main: 1500, product: 500, skills: ["Cuts & Styling", "Colour"], days: [1, 2, 3, 4, 5] },
  { name: "Priya Nair", email: "priya@luxebeauty.demo", color: "#059669", position: "Nail Technician", payType: "commission", main: 5000, product: 500, skills: ["Manicure", "Pedicure"], days: [2, 3, 4, 5, 6] },
  { name: "Sofia Rossi", email: "sofia@luxebeauty.demo", color: "#7c3aed", position: "Lash Artist", payType: "hourly", hourly: 2000, main: 2000, product: 500, skills: ["Lashes & Brows", "Skin"], days: [1, 3, 4, 5, 6] },
  { name: "Marcus Chen", email: "marcus@luxebeauty.demo", color: "#d97706", position: "Massage Therapist", payType: "commission", main: 5500, product: 500, skills: ["Massage"], days: [1, 2, 4, 5, 6] },
  { name: "Dana Whitfield", email: "dana@luxebeauty.demo", color: "#64748b", position: "Front Desk", payType: "salary", salary: 180000, product: 500, skills: [], days: [1, 2, 3, 4, 5], frontDesk: true },
];

const FIRST = ["Emma", "Olivia", "Sophia", "Isabella", "Mia", "Charlotte", "Amelia", "Harper", "Evelyn", "Abigail", "Ella", "Scarlett", "Grace", "Chloe", "Victoria", "Riley", "Aria", "Lily", "Zoe", "Nora", "Hannah", "Layla", "Ellie", "Natalie", "Leah", "Liam", "Noah", "Ethan", "Lucas", "Mason", "Daniel", "James", "Aiden", "Henry", "Owen", "Maya", "Jasmine", "Naomi", "Camila", "Ruby"];
const LAST = ["Johnson", "Williams", "Brown", "Jones", "Garcia", "Miller", "Davis", "Rodriguez", "Martinez", "Hernandez", "Lopez", "Gonzalez", "Wilson", "Anderson", "Thomas", "Taylor", "Moore", "Jackson", "Martin", "Lee", "Perez", "Thompson", "White", "Harris", "Sanchez", "Clark", "Ramirez", "Lewis", "Robinson", "Walker", "Young", "Allen", "King", "Wright", "Scott", "Torres", "Nguyen", "Hill", "Flores", "Green"];
const COMMENTS = ["Absolutely love my hair! Ava listened and nailed the colour.", "Clean, calm and on time. Will be back.", "Best gel manicure I've had, two weeks and still perfect.", "Jordan gave me the exact cut I showed him. Great chat too.", "Lashes look so natural. Sofia is meticulous.", "Marcus worked out knots I've had for months.", "Lovely studio, easy online booking, friendly front desk.", "A little pricey but worth every penny.", "Priya is an artist. My nails get compliments daily.", "The facial left my skin glowing for days.", "Ran about 10 minutes late but the service was great.", "Relaxing atmosphere and thoughtful staff."];
const PRODUCTS = [
  { cat: "Hair care", name: "Hydrating Shampoo 250ml", price: 2800, cost: 1200, qty: 14 },
  { cat: "Hair care", name: "Hydrating Conditioner 250ml", price: 2900, cost: 1250, qty: 11 },
  { cat: "Hair care", name: "Heat Protect Spray", price: 2400, cost: 1000, qty: 6 },
  { cat: "Hair care", name: "Colour-Safe Gloss Mask", price: 3600, cost: 1500, qty: 2 },
  { cat: "Skin care", name: "Vitamin C Serum", price: 5800, cost: 2400, qty: 8 },
  { cat: "Skin care", name: "Daily SPF 50", price: 3200, cost: 1300, qty: 9 },
  { cat: "Skin care", name: "Gentle Cleanser", price: 2600, cost: 1000, qty: 12 },
  { cat: "Nails", name: "Cuticle Oil Pen", price: 1400, cost: 500, qty: 20 },
  { cat: "Nails", name: "Strengthening Base Coat", price: 1800, cost: 700, qty: 7 },
  { cat: "Tools & Gifts", name: "Boar Bristle Brush", price: 3400, cost: 1500, qty: 4 },
  { cat: "Tools & Gifts", name: "Silk Pillowcase", price: 4500, cost: 2000, qty: 5 },
  { cat: "Tools & Gifts", name: "Luxe Gift Box", price: 7500, cost: 3500, qty: 3 },
];

// ---------------------------------------------------------------------------
async function main() {
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
  let user = await db.query.user.findFirst({ where: eq(schema.user.email, EMAIL) });
  if (!user) {
    await auth.api.signUpEmail({ body: { email: EMAIL, password: PASSWORD, name: "Demo Owner" } });
    user = (await db.query.user.findFirst({ where: eq(schema.user.email, EMAIL) }))!;
    await db.update(schema.user).set({ emailVerified: true }).where(eq(schema.user.id, user.id));
  }
  const signIn = await auth.api.signInEmail({ body: { email: EMAIL, password: PASSWORD }, returnHeaders: true });
  const cookie = (signIn.headers.getSetCookie?.() ?? [signIn.headers.get("set-cookie") ?? ""]).map((c) => c.split(";")[0]).filter(Boolean).join("; ");
  const h = new Headers({ cookie });
  const org = await auth.api.createOrganization({ headers: h, body: { name: NAME, slug: SLUG, metadata: { timezone: TZ } } });
  if (!org) throw new Error("Could not create the demo organization");
  const businessId = org.id;
  console.log(`Created ${NAME} (${businessId})`);

  // --- Business profile and settings
  const logoUrl = await tile(businessId, "category", "Luxe", "✨", 5);
  const coverUrl = await tile(businessId, "category", NAME, "🌿", 7);
  await db.update(schema.businesses).set({
    phone: "(703) 555-0142", email: "hello@luxebeauty.demo", addressLine: "128 Market Street, Sterling, VA 20164", tagline: "Hair, nails, lashes, skin and massage under one roof",
    about: "A calm, light-filled studio in the heart of Sterling. Our team of specialists has been making clients feel their best since 2019. Walk-ins welcome when the calendar allows; booking online guarantees your spot.",
    website: "https://luxebeauty.demo", instagram: "luxebeautystudio", brandColor: "#be185d", logoUrl, coverUrl,
    bookingPolicy: "Please arrive 5 minutes early. Cancellations inside 24 hours may be charged 50% of the service.", cancelWindowHours: 24, reminderHours: 24, maxAdvanceDays: 60,
    reviewRequestEnabled: true, reviewRequestDelayHours: 2, googleReviewUrl: "https://g.page/r/demo/review", loyaltyEnabled: true, loyaltyPointsPerDollar: 1, loyaltyMinRedeemPoints: 500, referralBonusPoints: 500, referralFriendBonusPoints: 250,
    clientAccountsEnabled: true, storeEnabled: true, giftCardsOnline: true, shippingFlatCents: 795, taxRateBps: 600,
  }).where(eq(schema.businesses.id, businessId));

  await withTenant(businessId, async (tx) => {
    const [loc] = await tx.select().from(schema.locations);
    const locationId = loc!.id;
    const hours = { "0": null, "1": { open: "10:00", close: "18:00" }, "2": { open: "09:00", close: "19:00" }, "3": { open: "09:00", close: "19:00" }, "4": { open: "09:00", close: "20:00" }, "5": { open: "09:00", close: "19:00" }, "6": { open: "09:00", close: "17:00" } };
    await tx.update(schema.locations).set({ name: NAME, addressLine1: "128 Market Street", city: "Sterling", state: "VA", phone: "(703) 555-0142", hours }).where(eq(schema.locations.id, locationId));

    // --- Menu: nested categories with images, services with images
    const serviceIds: { id: string; name: string; min: number; price: number; gap: number; finish: number; group: string; capacity: number }[] = [];
    const colourIds: string[] = [];
    let tileNo = 0;
    const insertCat = async (c: Cat, parentId: string | null, order: number): Promise<string> => {
      const imageUrl = await tile(businessId, "category", c.name, c.emoji, tileNo++);
      const [row] = await tx.insert(schema.serviceCategories).values({ businessId, name: c.name, parentId, description: c.desc || null, prepNotes: c.prep ?? null, imageUrl, sortOrder: order }).returning({ id: schema.serviceCategories.id });
      let i = 0;
      for (const child of c.children ?? []) await insertCat(child, row!.id, i++);
      let j = 0;
      for (const s of c.services ?? []) {
        const img = await tile(businessId, "service", s.name, s.emoji, tileNo++);
        const [sv] = await tx.insert(schema.services).values({ businessId, categoryId: row!.id, name: s.name, description: s.desc ?? null, prepNotes: s.prep ?? null, imageUrl: img, durationMin: s.min, gapMin: s.gap ?? 0, finishMin: s.finish ?? 0, bufferAfterMin: 10, priceCents: s.price, depositCents: s.deposit ?? 0, capacity: s.capacity ?? 1, sortOrder: j++ }).returning({ id: schema.services.id });
        serviceIds.push({ id: sv!.id, name: s.name, min: s.min, price: s.price, gap: s.gap ?? 0, finish: s.finish ?? 0, group: c.name, capacity: s.capacity ?? 1 });
        if (c.name === "Colour") colourIds.push(sv!.id);
      }
      return row!.id;
    };
    let k = 0;
    for (const c of MENU) await insertCat(c, null, k++);
    console.log(`Menu: ${serviceIds.length} services`);

    // --- Staff (the owner row exists from the hook; make it a non-provider owner)
    const owner = (await tx.select().from(schema.staff))[0]!;
    await tx.update(schema.staff).set({ displayName: "Demo Owner", takesAppointments: false, bookableOnline: false, position: "Owner", payType: "salary", color: "#0f172a" }).where(eq(schema.staff.id, owner.id));
    await tx.delete(schema.staffSchedules).where(eq(schema.staffSchedules.staffId, owner.id));
    const staffRows: { id: string; name: string; skills: string[]; days: number[]; hourly: boolean; frontDesk: boolean }[] = [];
    for (const [i, s] of STAFF.entries()) {
      const [row] = await tx.insert(schema.staff).values({
        businessId, displayName: s.name, email: s.email, color: s.color, locationId, position: s.position, payType: s.payType, mainCommissionBps: s.main ?? 0, productCommissionBps: s.product, ccTipFeeBps: 300,
        hourlyRateCents: s.hourly ?? 0, salaryPerPeriodCents: s.salary ?? 0, takesAppointments: !s.frontDesk, bookableOnline: !s.frontDesk, sortOrder: i,
      }).returning({ id: schema.staff.id });
      await tx.insert(schema.staffSchedules).values(s.days.map((weekday) => ({ businessId, staffId: row!.id, weekday, startTime: weekday === 1 ? "10:00" : "09:00", endTime: weekday === 6 ? "17:00" : "18:00", locationId: null })));
      const mine = serviceIds.filter((sv) => s.skills.includes(sv.group));
      if (mine.length) await tx.insert(schema.staffServices).values(mine.map((sv) => ({ businessId, staffId: row!.id, serviceId: sv.id })));
      staffRows.push({ id: row!.id, name: s.name, skills: s.skills, days: s.days, hourly: s.payType !== "commission", frontDesk: !!s.frontDesk });
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
        tags: chance(0.3) ? [pick(["VIP", "Colour client", "Referred", "Bridal"])] : [], notes: chance(0.25) ? pick(["Allergic to PPD – patch test done 2026-03.", "Prefers quiet appointments.", "Always books with Ava.", "Sensitive scalp; use gentle line."]) : null,
        referralCode: `LUXE${String(100 + i)}`, createdAt, homeLocationId: locationId,
      }).returning({ id: schema.clients.id });
      clientIds.push({ id: c!.id, first, last });
    }

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
        if (!p.days.includes(weekday)) continue;
        const mine = bookable.filter((s) => p.skills.includes(s.group));
        if (!mine.length) continue;
        let cursorMin = (weekday === 1 ? 10 : 9) * 60 + pick([0, 15, 30, 45]);
        const endOfDay = (weekday === 6 ? 17 : 18) * 60;
        const perDay = past ? between(3, 5) : offset === 0 ? between(2, 4) : between(1, 3);
        for (let n = 0; n < perDay && cursorMin < endOfDay - 60; n++) {
          const svc = pick(mine);
          const client = pick(clientIds);
          const startAt = zonedToInstant(day, `${String(Math.floor(cursorMin / 60)).padStart(2, "0")}:${String(cursorMin % 60).padStart(2, "0")}`, TZ);
          const total = svc.min + svc.gap + svc.finish;
          const endAt = new Date(startAt.getTime() + total * 60_000);
          const status = past ? (chance(0.9) ? "completed" : chance(0.5) ? "no_show" : "cancelled") : chance(0.5) ? "confirmed" : "booked";
          const [appt] = await tx.insert(schema.appointments).values({ businessId, locationId, clientId: client.id, status, source: chance(0.6) ? "online" : "staff", createdAt: new Date(startAt.getTime() - between(1, 20) * 86_400_000), cancelledAt: status === "cancelled" ? new Date(startAt.getTime() - 86_400_000 * 2) : null, notes: chance(0.15) ? pick(["Wants to go a shade lighter", "Running 5 min late last time", "Bring inspiration photos"]) : null }).returning({ id: schema.appointments.id });
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
          const [sale] = await tx.insert(schema.sales).values({ businessId, number, appointmentId: appt!.id, locationId, clientId: client.id, status: "paid", subtotalCents: subtotal, taxCents: tax, tipCents: tip, totalCents, paidCents: totalCents, closedAt, createdAt: closedAt, createdByUserId: user!.id }).returning({ id: schema.sales.id });
          await tx.insert(schema.saleLines).values({ businessId, saleId: sale!.id, kind: "service", staffId: p.id, serviceId: svc.id, appointmentItemId: item!.id, name: svc.name, quantity: 1, unitCents: svc.price, amountCents: svc.price, taxable: false, sortOrder: 0 });
          if (retail) await tx.insert(schema.saleLines).values({ businessId, saleId: sale!.id, kind: "product", staffId: p.id, name: retail.name, quantity: 1, unitCents: retail.price, amountCents: retail.price, taxable: true, sortOrder: 1 });
          if (tip) await tx.insert(schema.saleLines).values({ businessId, saleId: sale!.id, kind: "tip", staffId: p.id, name: "Tip", quantity: 1, unitCents: tip, amountCents: tip, taxable: false, sortOrder: 2 });
          const card = chance(0.7);
          await tx.insert(schema.payments).values({ businessId, saleId: sale!.id, method: card ? "card" : "cash", status: "succeeded", amountCents: totalCents, tipCents: tip, cardBrand: card ? pick(["visa", "mastercard", "amex"]) : null, cardLast4: card ? String(between(1000, 9999)) : null, createdAt: closedAt, createdByUserId: user!.id });
          salesN++;
          if (chance(0.3)) {
            const rating = chance(0.8) ? 5 : chance(0.7) ? 4 : 3;
            await tx.insert(schema.reviews).values({ businessId, clientId: client.id, appointmentId: appt!.id, staffId: p.id, locationId, rating, comment: chance(0.7) ? pick(COMMENTS) : null, requestedAt: closedAt, submittedAt: new Date(closedAt.getTime() + between(2, 30) * 3_600_000), createdAt: closedAt });
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
        if (!p.days.includes(weekday)) continue;
        const start = zonedToInstant(day, weekday === 1 ? "09:55" : "08:52", TZ);
        const minutes = between(420, 500);
        await tx.insert(schema.timeEntries).values({ businessId, staffId: p.id, date: day, minutes, locationId, clockInAt: start, clockOutAt: new Date(start.getTime() + minutes * 60_000) });
      }
    }

    // --- Products
    const prodCats = new Map<string, string>();
    let pc = 0;
    for (const name of [...new Set(PRODUCTS.map((p) => p.cat))]) {
      const [row] = await tx.insert(schema.productCategories).values({ businessId, name, sortOrder: pc++ }).returning({ id: schema.productCategories.id });
      prodCats.set(name, row!.id);
    }
    for (const [i, p] of PRODUCTS.entries()) {
      const [row] = await tx.insert(schema.products).values({ businessId, categoryId: prodCats.get(p.cat)!, name: p.name, sku: `LX-${String(100 + i)}`, priceCents: p.price, costCents: p.cost, taxable: true, sellOnline: true, trackStock: true, stockQty: p.qty, lowStockThreshold: 3, description: "Salon-grade, recommended by our team." }).returning({ id: schema.products.id });
      await tx.insert(schema.stockMovements).values({ businessId, productId: row!.id, delta: p.qty, reason: "received", note: "Opening stock" });
    }

    // --- Forms
    const colour = colourIds;
    await tx.insert(schema.forms).values([
      { businessId, name: "New client intake", kind: "intake", description: "Helps us personalise your visit.", applyToAll: true, requireSignature: false, renewDays: 365, fields: [
        { id: "f1", type: "text", label: "How did you hear about us?", required: false },
        { id: "f2", type: "multiselect", label: "Any of the following?", options: ["Sensitive skin", "Allergies to hair colour", "Pregnant or nursing", "Recent chemical treatment"] },
        { id: "f3", type: "textarea", label: "Anything else we should know?" },
        { id: "f4", type: "checkbox", label: "I'd like to receive occasional offers by text" },
      ] },
      { businessId, name: "Colour service consent", kind: "consent", description: "Please read and sign before your colour appointment.", serviceIds: colour, requireSignature: true, renewDays: 180, fields: [
        { id: "c1", type: "statement", label: "Colour results vary with hair history. A strand or patch test may be recommended. Results on previously coloured or box-dyed hair cannot be guaranteed." },
        { id: "c2", type: "checkbox", label: "I have disclosed all previous chemical services on my hair", required: true },
        { id: "c3", type: "checkbox", label: "I understand colour correction may take more than one visit", required: true },
      ] },
    ]);

    // --- Packages, memberships, gift cards, promo, waitlist, automations
    const blowout = serviceIds.find((s) => s.name === "Blowout")!;
    const facial = serviceIds.find((s) => s.name === "Signature Facial")!;
    const gel = serviceIds.find((s) => s.name === "Gel Manicure")!;
    await tx.insert(schema.packages).values([
      { businessId, name: "5 Blowouts", serviceId: blowout.id, sessions: 5, priceCents: 20000, validDays: 180 },
      { businessId, name: "3 Gel Manicures", serviceId: gel.id, sessions: 3, priceCents: 12000, validDays: 120 },
    ]);
    await tx.insert(schema.membershipPlans).values([
      { businessId, name: "Glow Monthly", priceCents: 9900, includedServiceId: facial.id, includedSessions: 1, discountBps: 1000, description: "One Signature Facial a month plus 10% off everything else." },
      { businessId, name: "Polished Club", priceCents: 7900, includedServiceId: gel.id, includedSessions: 2, discountBps: 500, description: "Two gel manicures a month and 5% off retail." },
    ]);
    for (const [i, c] of clientIds.slice(0, 3).entries()) await tx.insert(schema.giftCards).values({ businessId, code: `LUXE-GIFT-${1000 + i}`, initialCents: 10000, balanceCents: i === 0 ? 4500 : 10000, purchaserClientId: c.id, recipientName: `${c.first}'s friend`, locationId });
    await tx.insert(schema.promoCodes).values({ businessId, code: "WELCOME10", type: "percent", value: 10, maxUses: 100 });
    await tx.insert(schema.waitlist).values([
      { businessId, clientId: clientIds[5]!.id, serviceId: serviceIds.find((s) => s.name === "Full Balayage")!.id, staffId: providers[0]!.id, locationId, date: addDays(today, 3), notes: "Any time after 2pm" },
      { businessId, clientId: clientIds[9]!.id, serviceId: gel.id, locationId, date: addDays(today, 1), notes: "Lunchtime if possible" },
    ]);
  });

  // Workflows: every template exists; turn on the ones a busy salon would use.
  const biz = (await db.query.businesses.findFirst({ where: eq(schema.businesses.id, businessId) }))!;
  await ensureTemplates(biz);
  await withTenant(businessId, (tx) => tx.update(schema.workflows).set({ enabled: true }).where(sql`${schema.workflows.templateKey} in ('reminder','review_request','rebook','no_show_follow_up','welcome','birthday','win_back','membership_save','low_rating_alert')`));

  console.log(`\nDone. Sign in at ${appUrl("/sign-in")}\n  email:    ${EMAIL}\n  password: ${PASSWORD}\n  business: ${appUrl(`/app/${SLUG}`)}\n  booking:  ${appUrl(`/book/${SLUG}`)}`);
  await pg.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
