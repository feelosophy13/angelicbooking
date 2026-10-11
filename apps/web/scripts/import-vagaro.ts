/**
 * One-off, re-runnable loader for a full Vagaro export (the CSV set in
 * data/vagaro-export) into one business. Matches on natural keys (names,
 * phone/email, appointment time+staff+service) so running it twice adds nothing.
 *
 * Usage (from apps/web, against whatever DATABASE_URL points at):
 *   ../../packages/db/node_modules/.bin/tsx --env-file=../../.env scripts/import-vagaro.ts --business angelic-beauty [--dir ../../data/vagaro-export] [--dry-run]
 *
 * Mapping summary (see the report it prints):
 *   employees → staff (+ weekly hours, services performed)   services_full/addons/classes → service categories + services
 *   customers → clients (+ points ledger, referrals)          appointments → appointments + items (past → completed/no-show, future → booked/confirmed)
 *   calendar_blocks (future) → day-off overrides or "Blocked" appointment items
 *   products → product categories + products (stock, cost, online)   packages/sold_packages → packages + client packages
 *   memberships/sold_memberships → plans + client memberships (no card billing carried over)
 *   gift_cards → gift cards (balance kept)                   discounts with a % in the title → promo codes
 *   locations: "Angelic Beauty" and "Angelic Lashes by Tiffany" are created/renamed; sold items are not location-bound in the app.
 */
import fs from "node:fs";
import { resolveAppointmentLocation } from "../src/server/booking";
import path from "node:path";
import { and, eq, sql } from "drizzle-orm";
import { db, getSql, schema, withTenant, type TenantDb } from "@angelic/db";
import { normalizePhone, zonedToInstant } from "@angelic/core";
import { parseCsv } from "../src/lib/import/parse";

const args = process.argv.slice(2);
const opt = (k: string, d?: string) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const DRY = args.includes("--dry-run");
const SLUG = opt("--business", "angelic-beauty")!;
const DIR = path.resolve(process.cwd(), opt("--dir", "../../data/vagaro-export")!);
const TODAY = new Date();

// Every column name in the export, so field access is typed as a plain string. A column missing
// from a file reads as "" (see csv()).
type Key = "acquisition" | "active" | "addon" | "addon_category" | "addon_count" | "addons" | "auto_renew" | "avg_cost" | "barcode" | "bio" | "birth_date" | "booked_via" | "bookings" | "brand" | "business" | "business_use" | "calendar_display" | "category" | "cell" | "charge_frequency" | "checked_in" | "city" | "class_name" | "cleanup_min" | "color" | "confirm_id" | "cost_price" | "created" | "created_by" | "current_balance" | "customer" | "customer_email" | "customer_phone" | "customer_since" | "date" | "day" | "day_phone" | "deleted" | "deposit" | "description" | "duration_min" | "email" | "email_valid" | "employee" | "end" | "event_type" | "expires" | "first_name" | "frequency" | "gender" | "gift_card_no" | "has_note" | "inactive" | "info_birthDate" | "info_cellCountryID" | "info_city" | "info_countryID" | "info_dayPhone" | "info_dayPhoneCountryID" | "info_dialingCode" | "info_emailFailedReason" | "info_isFirstTimeCustomer" | "info_isMultilocationUser" | "info_isNotifyByAdminEmail" | "info_isNotifyByAdminText" | "info_isNotifyByEmail" | "info_isNotifyByPushNotification" | "info_isNotifyBySMS" | "info_isSoftDelete" | "info_isValidEmail" | "info_isValidText" | "info_message" | "info_nightPhone" | "info_nightPhoneCountryID" | "info_showContactInfo" | "info_stateID" | "info_street" | "info_streetNo" | "info_textFailedReason" | "info_twoWayAuthCodeReceiveMode" | "info_userType" | "info_zip" | "initial_amount" | "initial_discount" | "last_cost" | "last_name" | "last_visited" | "lineup_order" | "live_stream" | "max_family_friends" | "membership" | "name" | "next_payment" | "night_phone" | "no_show_cancel" | "note" | "online" | "online_booking" | "package" | "paused" | "photo" | "points" | "points_given" | "points_redeem" | "prepaid" | "price" | "price_starting_at" | "process_duration_min" | "process_start_min" | "product" | "product_discount_pct" | "product_type" | "promo_discount_pct" | "purchased" | "purchased_at" | "quantity" | "recurring" | "recurring_limit" | "referred_by" | "refunded" | "remaining_cycles" | "renewal_status" | "reports_to" | "resource" | "restricted_to_service_id" | "revenue" | "reward_points" | "role" | "sender" | "service" | "service_discount_pct" | "service_providers" | "services_offered" | "sessions" | "sessions_initial" | "sessions_remaining" | "show_on_staff_page" | "show_price_online" | "sold_count" | "start" | "start_date" | "state" | "status" | "status_code" | "street" | "tags" | "taxation" | "text_valid" | "title" | "total_paid" | "track_inventory" | "type" | "vagaro_calendar_id" | "vagaro_customer_id" | "vagaro_id" | "vagaro_membership_id" | "vagaro_service_id" | "vagaro_user_id" | "vagaro_user_membership_id" | "vagaro_user_type" | "vendor" | "void_date" | "void_reason" | "working_hours" | "zip";
type Row = Record<Key, string>;
function csv(name: string): Row[] {
  const file = path.join(DIR, name);
  if (!fs.existsSync(file)) return [];
  const table = parseCsv(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
  const [head, ...rows] = table;
  const headers = (head ?? []).map((h) => h.trim());
  return rows
    .filter((r) => r.some((c) => c && c.trim()))
    .map((r) => new Proxy(Object.fromEntries(headers.map((h, i) => [h, (r[i] ?? "").trim()])), { get: (t, k) => (typeof k === "string" ? (t[k] ?? "") : undefined) }) as Row);
}
const cents = (v: string | undefined) => Math.round(Number(String(v ?? "0").replace(/[$,]/g, "")) * 100) || 0;
const int = (v: string | undefined, d = 0) => { const n = Math.round(Number(v)); return Number.isFinite(n) ? n : d; };
const bool = (v: string | undefined) => ["1", "true", "yes"].includes(String(v ?? "").trim().toLowerCase());
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const splitName = (full: string) => { const p = full.trim().split(/\s+/); return { first: p[0] ?? "", last: p.slice(1).join(" ") }; };
const DOW: Record<string, number> = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };
const STATUS_PAST: Record<string, (typeof schema.appointmentStatus.enumValues)[number]> = { "5": "completed", "11": "completed", "1": "completed", "3": "no_show", "10": "cancelled" };
const STATUS_FUTURE: Record<string, (typeof schema.appointmentStatus.enumValues)[number]> = { "1": "booked", "11": "confirmed", "5": "confirmed", "10": "booked", "3": "cancelled" };

const isOverlap = (e: unknown) => {
  const err = e as { code?: string; cause?: { code?: string; constraint_name?: string } };
  return err.code === "23P01" || err.cause?.code === "23P01" || err.cause?.constraint_name === "appointment_items_no_double_booking";
};

const report: Record<string, { created: number; existing: number; skipped: number; notes: string[] }> = {};
const R = (k: string) => (report[k] ??= { created: 0, existing: 0, skipped: 0, notes: [] });
const note = (k: string, msg: string) => { const r = R(k); if (r.notes.length < 25) r.notes.push(msg); };

async function main() {
  const business = await db.query.businesses.findFirst({ where: eq(schema.businesses.slug, SLUG) });
  if (!business) throw new Error(`No business with slug ${SLUG}`);
  const tz = business.timezone;
  console.log(`${DRY ? "[dry run] " : ""}Importing ${DIR} into ${business.name} (${business.id}), timezone ${tz}`);
  if (DRY) {
    const files = fs.readdirSync(DIR).filter((f) => f.endsWith(".csv"));
    for (const f of files) console.log(`  ${f}: ${csv(f).length} rows`);
    return;
  }
  await withTenant(business.id, async (tx) => {
    const locations = await importLocations(tx, business.id);
    const staffByName = await importStaff(tx, business.id, locations);
    const serviceByName = await importServices(tx, business.id, staffByName);
    const clientIndex = await importClients(tx, business.id);
    await importAppointments(tx, business.id, tz, staffByName, serviceByName, clientIndex);
    await importBlocks(tx, business.id, tz, staffByName);
    await importProducts(tx, business.id);
    await importPackages(tx, business.id, clientIndex);
    await importMemberships(tx, business.id, clientIndex);
    await importGiftCards(tx, business.id, clientIndex);
    await importPromos(tx, business.id);
    await tx.insert(schema.auditLog).values({ businessId: business.id, actorUserId: null, action: "import.vagaro_full", entity: "import", entityId: DIR, diff: JSON.stringify(Object.fromEntries(Object.entries(report).map(([k, v]) => [k, { created: v.created, existing: v.existing, skipped: v.skipped }]))) });
  });
  console.log("\nSummary");
  for (const [k, v] of Object.entries(report)) {
    console.log(`  ${k.padEnd(22)} created ${String(v.created).padStart(5)}  existing ${String(v.existing).padStart(5)}  skipped ${String(v.skipped).padStart(4)}`);
    for (const n of v.notes) console.log(`      - ${n}`);
  }
}

// ---------------------------------------------------------------------------
async function importLocations(tx: TenantDb, businessId: string) {
  const want = ["Angelic Beauty - Sterling", "Angelic Lashes by Tiffany"]; // the Fairfax site is its own legal entity
  const existing = await tx.select().from(schema.locations);
  const out = new Map<string, string>();
  for (const name of want) {
    const alias = name.includes("Fairfax") ? ["angelic lashes", "fairfax"] : ["sterling"];
    let row = existing.find((l) => norm(l.name) === norm(name) || alias.some((a) => norm(l.name).includes(a)));
    if (!row && name.includes("Sterling")) row = existing.find((l) => l.isDefault);
    if (row) {
      out.set(name, row.id);
      R("locations").existing++;
    } else {
      const [ins] = await tx.insert(schema.locations).values({ businessId, name, isDefault: existing.length === 0 }).returning();
      out.set(name, ins!.id);
      R("locations").created++;
    }
  }
  return out;
}

async function importStaff(tx: TenantDb, businessId: string, locations: Map<string, string>) {
  const existing = await tx.select().from(schema.staff);
  const byName = new Map<string, string>();
  for (const s of existing) byName.set(norm(s.displayName), s.id);
  const providers = new Map(csv("employee_services.csv").map((r) => [norm(r.employee), true]));
  const colors = ["#7c3aed", "#0f766e", "#db2777", "#2563eb", "#d97706", "#059669", "#9333ea", "#dc2626", "#0891b2", "#4f46e5", "#65a30d", "#be185d"];
  let i = 0;
  for (const e of csv("employees.csv")) {
    const name = e.name.trim();
    if (!name || norm(name) === "house online") { R("staff").skipped++; continue; }
    const email = e.email.trim().toLowerCase() || null;
    const match = existing.find((s) => (email && s.email?.toLowerCase() === email) || norm(s.displayName) === norm(name) || (norm(name) === "admin user" && s.email?.toLowerCase() === email));
    if (match) {
      byName.set(norm(name), match.id);
      R("staff").existing++;
      continue;
    }
    const isProvider = providers.has(norm(name)) || int(e.services_offered) > 0;
    const [ins] = await tx
      .insert(schema.staff)
      .values({ businessId, displayName: name, email, phone: normalizePhone(e.cell) ?? null, color: colors[i++ % colors.length]!, position: e.role || null, bookableOnline: isProvider && bool(e.show_on_staff_page), takesAppointments: isProvider, active: true, sortOrder: int(e.lineup_order, 99), locationId: null }) // the export does not say where each person works: assign locations in Staff
      .returning();
    byName.set(norm(name), ins!.id);
    R("staff").created++;
  }
  // Weekly hours (replace whatever exists for imported staff that have rows in the export).
  const hours = csv("employee_hours.csv");
  const withHours = new Set(hours.map((h) => norm(h.employee)));
  // Re-runs keep the per-weekday location the owner set in Staff → Weekly hours; the export does not know it.
  const keptLoc = new Map<string, Map<number, string | null>>();
  for (const n of withHours) {
    const staffId = byName.get(n);
    if (!staffId) { note("hours", `no staff row for ${n}`); continue; }
    const rows = await tx.select({ weekday: schema.staffSchedules.weekday, locationId: schema.staffSchedules.locationId }).from(schema.staffSchedules).where(eq(schema.staffSchedules.staffId, staffId));
    keptLoc.set(staffId, new Map(rows.map((r) => [r.weekday, r.locationId])));
    await tx.delete(schema.staffSchedules).where(eq(schema.staffSchedules.staffId, staffId));
  }
  for (const h of hours) {
    const staffId = byName.get(norm(h.employee));
    const wd = DOW[h.day.slice(0, 3).toLowerCase()];
    if (!staffId || wd === undefined || !h.start || !h.end) { R("hours").skipped++; continue; }
    await tx.insert(schema.staffSchedules).values({ businessId, staffId, weekday: wd, startTime: h.start, endTime: h.end, locationId: keptLoc.get(staffId)?.get(wd) ?? null });
    R("hours").created++;
  }
  return byName;
}

async function importServices(tx: TenantDb, businessId: string, staffByName: Map<string, string>) {
  const cats = new Map<string, string>();
  for (const c of await tx.select().from(schema.serviceCategories)) cats.set(norm(c.name), c.id);
  let order = cats.size;
  const cat = async (name: string) => {
    const k = norm(name || "Services");
    if (cats.has(k)) return cats.get(k)!;
    const [ins] = await tx.insert(schema.serviceCategories).values({ businessId, name: name || "Services", sortOrder: order++ }).returning();
    cats.set(k, ins!.id);
    R("categories").created++;
    return ins!.id;
  };
  const existing = await tx.select().from(schema.services);
  const byName = new Map<string, string>();
  for (const s of existing) byName.set(norm(s.name), s.id);
  const upsert = async (input: { category: string; name: string; description?: string | null; durationMin: number; gapMin?: number; finishMin?: number; bufferAfterMin?: number; priceCents: number; online: boolean; active: boolean; capacity?: number; sortOrder?: number }, kind: string) => {
    const k = norm(input.name);
    if (!k) { R(kind).skipped++; return null; }
    if (byName.has(k)) { R(kind).existing++; return byName.get(k)!; }
    const [ins] = await tx
      .insert(schema.services)
      .values({ businessId, categoryId: await cat(input.category), name: input.name.slice(0, 120), description: input.description?.slice(0, 2000) || null, durationMin: Math.max(5, input.durationMin), gapMin: Math.max(0, input.gapMin ?? 0), finishMin: Math.max(0, input.finishMin ?? 0), bufferAfterMin: Math.max(0, input.bufferAfterMin ?? 0), priceCents: input.priceCents, bookableOnline: input.online, active: input.active, capacity: input.capacity ?? 1, sortOrder: input.sortOrder ?? 0 })
      .returning();
    byName.set(k, ins!.id);
    R(kind).created++;
    return ins!.id;
  };
  let so = 0;
  const full = csv("services_full.csv");
  const base = full.length ? full : csv("services.csv");
  for (const r of base) {
    // Vagaro "process" = free gap after process_start minutes of work, then the rest of the service.
    const dur = int(r.duration_min, 30);
    const pStart = int(r.process_start_min);
    const pDur = int(r.process_duration_min);
    const timing = pDur > 0 && pStart > 0 && pStart < dur ? { durationMin: pStart, gapMin: pDur, finishMin: dur - pStart } : { durationMin: dur, gapMin: 0, finishMin: 0 };
    await upsert({ category: r.category, name: r.service, description: r.description, ...timing, bufferAfterMin: int(r.cleanup_min), priceCents: cents(r.price), online: bool(r.online) && !/staff only/i.test(r.category), active: r.active === "" ? true : bool(r.active), sortOrder: so++ }, "services");
  }
  for (const r of csv("addons.csv")) await upsert({ category: `Add-ons · ${r.addon_category || "Other"}`, name: r.addon, description: r.description, durationMin: Math.max(5, int(r.duration_min)), priceCents: cents(r.price), online: bool(r.online), active: true, sortOrder: so++ }, "addons");
  for (const r of csv("classes.csv")) {
    const id = await upsert({ category: r.category || "Classes", name: r.class_name, durationMin: 60, priceCents: 0, online: false, active: false, capacity: 8 }, "classes");
    if (id) note("classes", `"${r.class_name}" imported as an inactive class (set its price, length and group size, then enable)`);
  }
  // Who performs what, with price/duration overrides when they differ from the service.
  const existingPairs = new Set((await tx.select().from(schema.staffServices)).map((p) => `${p.staffId}:${p.serviceId}`));
  const services = await tx.select().from(schema.services);
  for (const r of csv("employee_services.csv")) {
    const staffId = staffByName.get(norm(r.employee));
    const serviceId = byName.get(norm(r.service));
    if (!staffId || !serviceId) { R("staff_services").skipped++; continue; }
    if (existingPairs.has(`${staffId}:${serviceId}`)) { R("staff_services").existing++; continue; }
    const svc = services.find((s) => s.id === serviceId)!;
    const price = cents(r.price);
    const dur = int(r.duration_min, svc.durationMin);
    await tx.insert(schema.staffServices).values({ businessId, staffId, serviceId, priceCentsOverride: price && price !== svc.priceCents ? price : null, durationMinOverride: dur && dur !== svc.durationMin + svc.gapMin + svc.finishMin && dur !== svc.durationMin ? dur : null });
    existingPairs.add(`${staffId}:${serviceId}`);
    R("staff_services").created++;
  }
  return byName;
}

type ClientIndex = { byPhone: Map<string, string>; byEmail: Map<string, string>; byName: Map<string, string>; byVagaro: Map<string, string> };

async function importClients(tx: TenantDb, businessId: string): Promise<ClientIndex> {
  const idx: ClientIndex = { byPhone: new Map(), byEmail: new Map(), byName: new Map(), byVagaro: new Map() };
  for (const c of await tx.select().from(schema.clients)) {
    if (c.phone) idx.byPhone.set(c.phone, c.id);
    if (c.email) idx.byEmail.set(c.email.toLowerCase(), c.id);
    idx.byName.set(norm(`${c.firstName} ${c.lastName}`), c.id);
  }
  const rows = csv("customers.csv");
  const pendingReferrals: { clientId: string; referredBy: string }[] = [];
  for (const r of rows) {
    const phone = normalizePhone(r.cell) ?? normalizePhone(r.day_phone) ?? null;
    const email = r.email.trim().toLowerCase() || null;
    let first = r.first_name.trim();
    let last = r.last_name.trim();
    if (!first && !last) {
      if (email) first = email.split("@")[0]!;
      else if (phone) first = "Client";
      else { R("clients").skipped++; continue; }
    }
    // Match by phone, then email; clients with neither are matched by name so re-runs don't duplicate them.
    const existingId = (phone && idx.byPhone.get(phone)) || (email && idx.byEmail.get(email)) || (!phone && !email ? idx.byName.get(norm(`${first} ${last}`)) : null) || null;
    if (existingId) {
      idx.byVagaro.set(r.vagaro_user_id, existingId);
      R("clients").existing++;
      continue;
    }
    const since = /^\d{4}-\d{2}-\d{2}/.test(r.customer_since) ? new Date(`${r.customer_since.slice(0, 10)}T12:00:00Z`) : undefined;
    const birthday = /^\d{4}-\d{2}-\d{2}/.test(r.birth_date) ? r.birth_date.slice(0, 10) : null;
    const tags = r.tags ? r.tags.split(/[;,|]/).map((t) => t.trim()).filter(Boolean).slice(0, 20) : [];
    const noShows = int(r.no_show_cancel);
    const [ins] = await tx
      .insert(schema.clients)
      .values({ businessId, firstName: first.slice(0, 60), lastName: last.slice(0, 60), email, phone, birthday, tags, smsOptIn: !!phone && (r.text_valid === "" || bool(r.text_valid)), emailOptIn: !!email && (r.email_valid === "" || bool(r.email_valid)), notes: noShows > 0 ? `Vagaro: ${noShows} no-show/late cancel${noShows === 1 ? "" : "s"}` : null, ...(since ? { createdAt: since } : {}) })
      .returning({ id: schema.clients.id });
    const id = ins!.id;
    if (phone) idx.byPhone.set(phone, id);
    if (email) idx.byEmail.set(email, id);
    idx.byName.set(norm(`${first} ${last}`), id);
    idx.byVagaro.set(r.vagaro_user_id, id);
    const points = int(r.points);
    if (points > 0) await tx.insert(schema.loyaltyLedger).values({ businessId, clientId: id, delta: points, reason: "adjust", note: "Balance imported from Vagaro" });
    if (r.referred_by.trim()) pendingReferrals.push({ clientId: id, referredBy: r.referred_by.trim() });
    R("clients").created++;
  }
  for (const p of pendingReferrals) {
    const refId = idx.byName.get(norm(p.referredBy));
    if (refId && refId !== p.clientId) await tx.update(schema.clients).set({ referredByClientId: refId, referralRewardedAt: new Date() }).where(eq(schema.clients.id, p.clientId));
  }
  return idx;
}

function findClient(idx: ClientIndex, name: string, phone: string | undefined, vagaroId?: string): string | null {
  if (vagaroId && idx.byVagaro.has(vagaroId)) return idx.byVagaro.get(vagaroId)!;
  const p = normalizePhone(phone);
  if (p && idx.byPhone.has(p)) return idx.byPhone.get(p)!;
  return idx.byName.get(norm(name)) ?? null;
}

async function importAppointments(tx: TenantDb, businessId: string, tz: string, staffByName: Map<string, string>, serviceByName: Map<string, string>, clients: ClientIndex) {
  const rows = csv("appointments.csv");
  const existing = new Set(
    (
      await tx
        .select({ staffId: schema.appointmentItems.staffId, startAt: schema.appointmentItems.startAt, name: schema.appointmentItems.serviceName })
        .from(schema.appointmentItems)
    ).map((i) => `${i.staffId}|${i.startAt.getTime()}|${norm(i.name)}`),
  );
  for (const r of rows) {
    const staffId = staffByName.get(norm(r.employee));
    if (!staffId || !/^\d{4}-\d{2}-\d{2}$/.test(r.date) || !/^\d{2}:\d{2}/.test(r.start)) { R("appointments").skipped++; note("appointments", `skipped: ${r.date} ${r.start} ${r.employee} ${r.service}`); continue; }
    const startAt = zonedToInstant(r.date, r.start.slice(0, 5), tz);
    const endAt = /^\d{2}:\d{2}/.test(r.end) ? zonedToInstant(r.date, r.end.slice(0, 5), tz) : new Date(startAt.getTime() + Math.max(15, int(r.duration_min, 30)) * 60_000);
    const serviceName = r.service.trim() || "Appointment";
    const key = `${staffId}|${startAt.getTime()}|${norm(serviceName)}`;
    if (existing.has(key)) { R("appointments").existing++; continue; }
    const past = startAt < TODAY;
    const status = (past ? STATUS_PAST[r.status_code] : STATUS_FUTURE[r.status_code]) ?? (past ? "completed" : "booked");
    const clientId = r.customer.trim() ? findClient(clients, r.customer, r.customer_phone, r.vagaro_customer_id) : null;
    if (r.customer.trim() && !clientId) note("appointments", `client not found for "${r.customer}" (${r.date})`);
    const notes = [r.addons ? `Add-ons: ${r.addons}` : null, r.booked_via ? `Booked via ${r.booked_via}` : null, bool(r.recurring) ? "Recurring in Vagaro" : null].filter(Boolean).join(" · ") || null;
    const [appt] = await tx
      .insert(schema.appointments)
      .values({ businessId, locationId: await resolveAppointmentLocation(tx, staffId, startAt, tz), clientId, status, source: "import", notes, depositCents: bool(r.deposit) ? 0 : 0, createdAt: past ? startAt : undefined })
      .returning({ id: schema.appointments.id });
    const item = { businessId, appointmentId: appt!.id, staffId, serviceId: serviceByName.get(norm(serviceName)) ?? null, serviceName: serviceName.slice(0, 120), startAt, endAt: endAt > startAt ? endAt : new Date(startAt.getTime() + 15 * 60_000), priceCents: cents(r.price), status };
    // History may overlap freely (Vagaro allowed it); future bookings are tried strictly first and
    // kept with allow_overlap when they clash, so nothing from the live calendar is lost.
    if (past) await tx.insert(schema.appointmentItems).values({ ...item, allowOverlap: true });
    else {
      try {
        await tx.transaction((sp) => sp.insert(schema.appointmentItems).values(item));
      } catch (e) {
        if (isOverlap(e)) {
          await tx.insert(schema.appointmentItems).values({ ...item, allowOverlap: true });
          note("appointments", `double-booked in Vagaro, kept: ${r.date} ${r.start} ${r.employee} · ${serviceName}`);
        } else throw e;
      }
    }
    existing.add(key);
    R("appointments").created++;
  }
}

async function importBlocks(tx: TenantDb, businessId: string, tz: string, staffByName: Map<string, string>) {
  const rows = csv("calendar_blocks.csv").filter((r) => r.date >= TODAY.toISOString().slice(0, 10));
  const existingItems = new Set((await tx.select({ staffId: schema.appointmentItems.staffId, startAt: schema.appointmentItems.startAt }).from(schema.appointmentItems)).map((i) => `${i.staffId}|${i.startAt.getTime()}`));
  const existingOff = new Set((await tx.select().from(schema.staffScheduleOverrides)).map((o) => `${o.staffId}|${o.date}`));
  for (const r of rows) {
    const staffId = staffByName.get(norm(r.employee));
    if (!staffId || !/^\d{4}-\d{2}-\d{2}$/.test(r.date)) { R("blocks").skipped++; continue; }
    const minutes = int(r.duration_min);
    if (minutes >= 480) {
      if (existingOff.has(`${staffId}|${r.date}`)) { R("blocks").existing++; continue; }
      await tx.insert(schema.staffScheduleOverrides).values({ businessId, staffId, date: r.date, isOff: true, note: r.note || "Blocked (Vagaro)" });
      existingOff.add(`${staffId}|${r.date}`);
      R("blocks").created++;
      continue;
    }
    const startAt = zonedToInstant(r.date, r.start.slice(0, 5), tz);
    if (existingItems.has(`${staffId}|${startAt.getTime()}`)) { R("blocks").existing++; continue; }
    const endAt = new Date(startAt.getTime() + Math.max(15, minutes) * 60_000);
    const [appt] = await tx.insert(schema.appointments).values({ businessId, clientId: null, status: "confirmed", source: "import", notes: r.note || "Blocked time (Vagaro)" }).returning({ id: schema.appointments.id });
    try {
      await tx.transaction((sp) => sp.insert(schema.appointmentItems).values({ businessId, appointmentId: appt!.id, staffId, serviceId: null, serviceName: `Blocked: ${(r.note || "unavailable").slice(0, 100)}`, startAt, endAt, priceCents: 0, status: "confirmed" }));
      existingItems.add(`${staffId}|${startAt.getTime()}`);
      R("blocks").created++;
    } catch (e) {
      if (isOverlap(e)) {
        await tx.delete(schema.appointments).where(eq(schema.appointments.id, appt!.id));
        R("blocks").skipped++;
        note("blocks", `overlaps a booking, skipped: ${r.date} ${r.start} ${r.employee}`);
      } else throw e;
    }
  }
}

async function importProducts(tx: TenantDb, businessId: string) {
  const cats = new Map<string, string>();
  for (const c of await tx.select().from(schema.productCategories)) cats.set(norm(c.name), c.id);
  const existing = new Map((await tx.select().from(schema.products)).map((p) => [norm(p.name), p.id]));
  for (const r of csv("products.csv")) {
    const name = r.product.trim();
    if (!name) { R("products").skipped++; continue; }
    if (existing.has(norm(name))) { R("products").existing++; continue; }
    const catName = r.product_type.trim() || "Other";
    let categoryId = cats.get(norm(catName));
    if (!categoryId) {
      const [c] = await tx.insert(schema.productCategories).values({ businessId, name: catName, sortOrder: cats.size }).returning();
      categoryId = c!.id;
      cats.set(norm(catName), categoryId);
    }
    const backbar = bool(r.business_use);
    const [p] = await tx
      .insert(schema.products)
      .values({ businessId, categoryId, name: name.slice(0, 120), sku: r.barcode.trim() && r.barcode.trim() !== name ? r.barcode.trim().slice(0, 60) : null, priceCents: cents(r.price), taxable: true, active: !backbar, sellOnline: bool(r.online) && !backbar, description: [r.brand ? `Brand: ${r.brand}` : null, backbar ? "Back-bar / business use" : null].filter(Boolean).join(" · ") || null, trackStock: bool(r.track_inventory), stockQty: Math.max(0, int(r.quantity)), costCents: cents(r.avg_cost) || cents(r.last_cost) })
      .returning();
    if (p!.trackStock && p!.stockQty > 0) await tx.insert(schema.stockMovements).values({ businessId, productId: p!.id, delta: p!.stockQty, reason: "received", note: "Opening stock from Vagaro" });
    existing.set(norm(name), p!.id);
    R("products").created++;
  }
}

async function importPackages(tx: TenantDb, businessId: string, clients: ClientIndex) {
  const existing = new Map((await tx.select().from(schema.packages)).map((p) => [norm(p.name), p]));
  for (const r of csv("packages.csv")) {
    if (existing.has(norm(r.name))) { R("packages").existing++; continue; }
    const [p] = await tx.insert(schema.packages).values({ businessId, name: r.name.slice(0, 120), serviceId: null, sessions: Math.max(1, int(r.sessions, 1)), priceCents: cents(r.price), active: bool(r.active) }).returning();
    existing.set(norm(r.name), p!);
    R("packages").created++;
  }
  const sold = csv("sold_packages.csv");
  const have = new Set((await tx.select().from(schema.clientPackages)).map((c) => `${c.clientId}|${c.packageId}|${c.createdAt.toISOString().slice(0, 10)}`));
  for (const r of sold) {
    let pkg = existing.get(norm(r.package));
    if (!pkg && r.package.trim()) {
      // Sold under a package that no longer exists in the catalogue: keep it as a hidden legacy package so the sessions still redeem.
      const [p] = await tx.insert(schema.packages).values({ businessId, name: r.package.trim().slice(0, 120), serviceId: null, sessions: Math.max(1, Math.round(Number(r.sessions_initial) || 1)), priceCents: cents(r.initial_amount), active: false }).returning();
      pkg = p!;
      existing.set(norm(r.package), pkg);
      note("packages", `legacy package created (hidden): ${r.package.trim()}`);
      R("packages").created++;
    }
    const clientId = findClient(clients, r.customer, undefined) ?? (r.customer_email ? clients.byEmail.get(r.customer_email.toLowerCase()) : null);
    if (!pkg || !clientId) { R("client_packages").skipped++; note("client_packages", `no client for ${r.customer} / ${r.package}`); continue; }
    const purchased = /^\d{4}-\d{2}-\d{2}/.test(r.purchased) ? r.purchased.slice(0, 10) : TODAY.toISOString().slice(0, 10);
    if (have.has(`${clientId}|${pkg.id}|${purchased}`)) { R("client_packages").existing++; continue; }
    await tx.insert(schema.clientPackages).values({ businessId, clientId, packageId: pkg.id, serviceId: null, remaining: Math.max(0, Math.round(Number(r.sessions_remaining) || 0)), expiresAt: /^\d{4}-\d{2}-\d{2}/.test(r.expires) ? new Date(`${r.expires.slice(0, 10)}T23:59:59`) : null, createdAt: new Date(`${purchased}T12:00:00Z`) });
    have.add(`${clientId}|${pkg.id}|${purchased}`);
    R("client_packages").created++;
  }
}

async function importMemberships(tx: TenantDb, businessId: string, clients: ClientIndex) {
  const plans = new Map((await tx.select().from(schema.membershipPlans)).map((p) => [norm(p.name), p]));
  for (const r of csv("memberships.csv")) {
    if (plans.has(norm(r.name))) { R("membership_plans").existing++; continue; }
    const freq = r.charge_frequency.trim();
    const desc = [r.description, freq && !/monthly/i.test(freq) ? `Billed ${freq.toLowerCase()} in Vagaro` : null].filter(Boolean).join(" · ") || null;
    const includes = /(\d+)\s*(?:x|×)?\s*(?:lash|pass|fill|session|visit)/i.exec(r.description ?? "");
    const [p] = await tx.insert(schema.membershipPlans).values({ businessId, name: r.name.slice(0, 120), priceCents: cents(r.price), includedSessions: includes ? Math.min(10, int(includes[1], 1)) : 1, discountBps: Math.round(Number(r.service_discount_pct || 0) * 100), description: desc?.slice(0, 2000) ?? null, active: bool(r.active) }).returning();
    plans.set(norm(r.name), p!);
    R("membership_plans").created++;
  }
  const have = new Set((await tx.select().from(schema.clientMemberships)).map((m) => `${m.clientId}|${m.planId}`));
  for (const r of csv("sold_memberships.csv")) {
    const plan = plans.get(norm(r.membership));
    const clientId = (r.vagaro_user_id && clients.byVagaro.get(r.vagaro_user_id)) || findClient(clients, r.customer, undefined);
    if (!plan || !clientId) { R("client_memberships").skipped++; continue; }
    const live = !bool(r.inactive) && !bool(r.deleted);
    if (!live) { R("client_memberships").skipped++; continue; } // only current memberships carry over
    if (have.has(`${clientId}|${plan.id}`)) { R("client_memberships").existing++; continue; }
    const next = /^\d{4}-\d{2}-\d{2}/.test(r.next_payment) ? new Date(`${r.next_payment.slice(0, 10)}T12:00:00Z`) : new Date(TODAY.getTime() + 30 * 86_400_000);
    await tx.insert(schema.clientMemberships).values({ businessId, clientId, planId: plan.id, status: bool(r.paused) ? "paused" : "active", startedAt: /^\d{4}-\d{2}-\d{2}/.test(r.created) ? new Date(`${r.created.slice(0, 10)}T12:00:00Z`) : TODAY, currentPeriodEnd: next, creditsRemaining: plan.includedSessions, autoRenew: false });
    have.add(`${clientId}|${plan.id}`);
    R("client_memberships").created++;
  }
  note("client_memberships", "Vagaro card billing does not carry over: turn on auto-renew per client once they have a saved card.");
}

async function importGiftCards(tx: TenantDb, businessId: string, clients: ClientIndex) {
  const have = new Set((await tx.select({ code: schema.giftCards.code }).from(schema.giftCards)).map((g) => g.code));
  for (const r of csv("gift_cards.csv")) {
    const code = r.gift_card_no.trim().toUpperCase();
    if (!code) { R("gift_cards").skipped++; continue; }
    if (have.has(code)) { R("gift_cards").existing++; continue; }
    const purchaser = findClient(clients, r.customer, undefined) ?? (r.customer_email ? clients.byEmail.get(r.customer_email.toLowerCase()) : null) ?? null;
    await tx.insert(schema.giftCards).values({ businessId, code, initialCents: cents(r.initial_amount), balanceCents: Math.max(0, cents(r.current_balance)), purchaserClientId: purchaser, recipientName: r.customer.trim() || null, expiresAt: /^\d{4}-\d{2}-\d{2}/.test(r.expires) ? new Date(`${r.expires.slice(0, 10)}T23:59:59`) : null, active: !r.void_date && cents(r.current_balance) > 0, createdAt: /^\d{4}-\d{2}-\d{2}/.test(r.purchased) ? new Date(`${r.purchased.slice(0, 10)}T12:00:00Z`) : TODAY });
    have.add(code);
    R("gift_cards").created++;
  }
}

async function importPromos(tx: TenantDb, businessId: string) {
  const have = new Set((await tx.select({ code: schema.promoCodes.code }).from(schema.promoCodes)).map((p) => p.code));
  for (const r of csv("discounts.csv")) {
    const pct = /(\d{1,3})\s*%/.exec(r.title);
    if (!pct || !bool(r.active)) { R("promo_codes").skipped++; continue; }
    const code = r.title.toUpperCase().replace(/\d{1,3}\s*%/, "").replace(/[^A-Z0-9]+/g, "").slice(0, 20);
    if (!code || have.has(code)) { R("promo_codes").existing++; continue; }
    await tx.insert(schema.promoCodes).values({ businessId, code, type: "percent", value: Math.min(100, int(pct[1], 10)), active: true });
    have.add(code);
    note("promo_codes", `"${r.title}" → code ${code}`);
    R("promo_codes").created++;
  }
}

main()
  .then(() => getSql().end())
  .catch(async (e) => {
    console.error(e);
    await getSql().end();
    process.exit(1);
  });

// keep helpers referenced
void and; void sql;
