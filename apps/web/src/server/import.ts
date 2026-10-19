import { and, eq, ilike, or, sql } from "drizzle-orm";
import { schema, withTenant } from "@angelic/db";
import { buildBookingSegments, normalizePhone, zonedToInstant } from "@angelic/core";
import { parseBirthday, parseBool, parseDate, parseDuration, parseTime, splitName, type ImportKind } from "@/lib/import/mapping";
import { sameClientName } from "@/lib/client-match";
import { timingFor } from "./availability";
import { isSmsSuppressed } from "./consent";
import { afterAppointmentBooked } from "@/lib/notify";

type Business = typeof schema.businesses.$inferSelect;
export interface ImportResult {
  created: number;
  updated: number;
  skipped: number;
  errors: { row: number; message: string }[];
}

const get = (row: Record<string, string>, mapping: Record<string, string>, key: string) => {
  const h = mapping[key];
  return h ? (row[h] ?? "").trim() : "";
};
/** Run one row inside a savepoint so a failure doesn't poison the whole transaction. */
async function perRow<T>(tx: Tx, fn: () => Promise<T>): Promise<T> {
  await tx.execute(sql`savepoint import_row`);
  try {
    const out = await fn();
    await tx.execute(sql`release savepoint import_row`);
    return out;
  } catch (e) {
    if (process.env.DEBUG_IMPORT) console.error("[import] row failed:", (e as Error).message.slice(0, 200));
    await tx.execute(sql`rollback to savepoint import_row`);
    throw e;
  }
}

const money = (v: string) => {
  const n = Number(v.replace(/[^0-9.\-]/g, ""));
  return Number.isFinite(n) ? Math.round(n * 100) : null;
};

export async function runImport(business: Business, kind: ImportKind, rows: Record<string, string>[], mapping: Record<string, string>, actorUserId: string | null, filename: string): Promise<ImportResult> {
  const r: ImportResult = { created: 0, updated: 0, skipped: 0, errors: [] };
  const upcoming: string[] = [];
  // In batches, each committed on its own: a long file can't hit a timeout and roll everything back, and a re-run skips what already
  // landed (rows match existing clients, services and visits).
  for (let from = 0; from < rows.length; from += IMPORT_BATCH) {
    const batch = rows.slice(from, from + IMPORT_BATCH);
    await withTenant(business.id, async (tx) => {
      if (kind === "clients") await importClients(tx, business, batch, mapping, r, from);
      else if (kind === "services") await importServices(tx, business, batch, mapping, r, from);
      else await importAppointments(tx, business, batch, mapping, r, actorUserId, upcoming, from);
    });
  }
  await withTenant(business.id, async (tx) => {
    await tx.insert(schema.importJobs).values({
      businessId: business.id,
      kind,
      filename,
      rowCount: rows.length,
      created: r.created,
      updated: r.updated,
      skipped: r.skipped,
      errors: r.errors.slice(0, 200),
      mapping,
      createdByUserId: actorUserId,
    });
    await tx.insert(schema.auditLog).values({ businessId: business.id, actorUserId, action: `import.${kind}`, entity: "import", entityId: filename, diff: JSON.stringify({ rows: rows.length, ...r, errors: r.errors.length }) });
  });
  // Future visits get the salon's reminders like any booking made here (no confirmation: they were booked elsewhere already).
  for (const id of upcoming) await afterAppointmentBooked(business, id).catch((e) => console.error("[import] reminders failed", id, (e as Error).message));
  return r;
}

type Tx = Parameters<Parameters<typeof withTenant>[1]>[0];

/** Rows committed per transaction. */
export const IMPORT_BATCH = 500;

/**
 * The existing client a row is, if any: the same phone or email AND the same name (family members sharing a phone, or two people with
 * one email, stay separate people). A row with no phone or email matches by name only when exactly one client has that name.
 */
async function findClient(tx: Tx, first: string, last: string, phone: string | null, email: string | null) {
  const conds = [];
  if (phone) conds.push(eq(schema.clients.phone, phone));
  if (email) conds.push(sql`lower(${schema.clients.email}) = ${email.toLowerCase()}`);
  if (conds.length) {
    const hits = await tx.query.clients.findMany({ where: or(...conds), limit: 25 });
    return hits.find((c) => sameClientName(c, { firstName: first, lastName: last })) ?? null;
  }
  if (first) {
    const named = await tx.query.clients.findMany({ where: and(ilike(schema.clients.firstName, first), ilike(schema.clients.lastName, last || "")), limit: 2 });
    return named.length === 1 ? named[0]! : null;
  }
  return null;
}

async function importClients(tx: Tx, business: Business, rows: Record<string, string>[], mapping: Record<string, string>, r: ImportResult, offset = 0) {
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!;
    try {
      await perRow(tx, async () => {
      let first = get(row, mapping, "firstName");
      let last = get(row, mapping, "lastName");
      if (!first && get(row, mapping, "fullName")) ({ first, last } = splitName(get(row, mapping, "fullName")));
      if (!first) {
        r.skipped++;
        return;
      }
      const emailRaw = get(row, mapping, "email");
      const email = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(emailRaw) ? emailRaw.toLowerCase() : null;
      const phone = normalizePhone(get(row, mapping, "phone")) ?? (get(row, mapping, "phone") || null);
      // A birthday that parses goes in the birthday field (birthday messages use it); anything else is kept in the notes.
      const birthdayRaw = get(row, mapping, "birthday");
      const birthday = parseBirthday(birthdayRaw);
      const notesParts = [get(row, mapping, "notes"), birthdayRaw && !birthday ? `Birthday: ${birthdayRaw}` : ""].filter(Boolean);
      const smsOptIn = parseBool(get(row, mapping, "smsOptIn"));
      const emailOptIn = parseBool(get(row, mapping, "emailOptIn"));
      const existing = await findClient(tx, first, last, phone, email);
      // An opt-in column never overrides a STOP; marketing texts are never turned on by an import (no record of the client's consent).
      const stopped = await isSmsSuppressed(tx, phone);
      if (existing) {
        await tx
          .update(schema.clients)
          .set({
            email: existing.email ?? email,
            phone: existing.phone ?? phone,
            notes: existing.notes ?? (notesParts.join("\n") || null),
            birthday: existing.birthday ?? birthday,
            ...(smsOptIn != null ? { smsOptIn: smsOptIn && !stopped } : {}),
            ...(emailOptIn != null ? { emailOptIn } : {}),
          })
          .where(eq(schema.clients.id, existing.id));
        r.updated++;
      } else {
        await tx.insert(schema.clients).values({
          businessId: business.id,
          firstName: first,
          lastName: last,
          email,
          phone,
          notes: notesParts.join("\n") || null,
          birthday,
          smsOptIn: (smsOptIn ?? true) && !stopped,
          emailOptIn: emailOptIn ?? true,
          tags: ["imported"],
        });
        r.created++;
      }
      });
    } catch (e) {
      r.errors.push({ row: offset + i + 2, message: (e as Error).message });
    }
  }
}

async function importServices(tx: Tx, business: Business, rows: Record<string, string>[], mapping: Record<string, string>, r: ImportResult, offset = 0) {
  const catCache = new Map<string, string>();
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!;
    try {
      await perRow(tx, async () => {
      const name = get(row, mapping, "name");
      const durationMin = parseDuration(get(row, mapping, "durationMin"));
      const priceCents = money(get(row, mapping, "price"));
      if (!name || !durationMin || priceCents == null) {
        r.skipped++;
        return;
      }
      const existing = await tx.query.services.findFirst({ where: ilike(schema.services.name, name) });
      if (existing) {
        r.skipped++;
        return;
      }
      const catName = get(row, mapping, "category");
      let categoryId: string | null = null;
      if (catName) {
        categoryId = catCache.get(catName.toLowerCase()) ?? null;
        if (!categoryId) {
          const c = await tx.query.serviceCategories.findFirst({ where: ilike(schema.serviceCategories.name, catName) });
          if (c) categoryId = c.id;
          else {
            const [nc] = await tx.insert(schema.serviceCategories).values({ businessId: business.id, name: catName }).returning({ id: schema.serviceCategories.id });
            categoryId = nc!.id;
          }
          catCache.set(catName.toLowerCase(), categoryId);
        }
      }
      await tx.insert(schema.services).values({
        businessId: business.id,
        categoryId,
        name,
        description: get(row, mapping, "description") || null,
        durationMin,
        gapMin: parseDuration(get(row, mapping, "gapMin")) ?? 0,
        priceCents,
      });
      r.created++;
      });
    } catch (e) {
      r.errors.push({ row: offset + i + 2, message: (e as Error).message });
    }
  }
}

async function importAppointments(tx: Tx, business: Business, rows: Record<string, string>[], mapping: Record<string, string>, r: ImportResult, actorUserId: string | null, upcoming: string[] = [], offset = 0) {
  // Imported visits belong to a site like any other (the stylist's own, else the default), for reports, tax and the right Stripe account.
  const defaultLocationId = (await tx.query.locations.findFirst({ where: eq(schema.locations.isDefault, true), columns: { id: true } }))?.id ?? null;
  const staffRows = await tx.select().from(schema.staff);
  const services = await tx.select().from(schema.services);
  const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
  const staffByName = new Map(staffRows.map((s) => [norm(s.displayName), s]));
  const serviceByName = new Map(services.map((s) => [norm(s.name), s]));
  const statusMap: Record<string, (typeof schema.appointmentStatus.enumValues)[number]> = {
    booked: "booked", confirmed: "confirmed", accepted: "confirmed", completed: "completed", complete: "completed", "checked out": "completed", "no show": "no_show", noshow: "no_show", "no-show": "no_show", cancelled: "cancelled", canceled: "cancelled",
  };
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!;
    try {
      await perRow(tx, async () => {
      const date = parseDate(get(row, mapping, "date"));
      const time = parseTime(get(row, mapping, "time")) ?? parseTime(get(row, mapping, "date").split(/\s+/).slice(1).join(" "));
      const staffName = get(row, mapping, "staff");
      const serviceName = get(row, mapping, "service");
      const customer = get(row, mapping, "customer");
      if (!date || !time || !staffName || !serviceName || !customer) {
        r.skipped++;
        return;
      }
      const staff = staffByName.get(norm(staffName)) ?? staffRows.find((s) => norm(s.displayName).startsWith(norm(staffName).split(" ")[0]!));
      if (!staff) {
        r.errors.push({ row: offset + i + 2, message: `Unknown staff "${staffName}"` });
        return;
      }
      let service = serviceByName.get(norm(serviceName)) ?? null;
      if (!service) {
        // Create a placeholder service so history isn't lost; owner can tidy it up.
        const durationMin = parseDuration(get(row, mapping, "durationMin")) ?? 60;
        const priceCents = money(get(row, mapping, "price")) ?? 0;
        const [ns] = await tx.insert(schema.services).values({ businessId: business.id, name: serviceName, durationMin, priceCents, bookableOnline: false }).returning();
        service = ns!;
        serviceByName.set(norm(serviceName), service);
      }
      const { first, last } = splitName(customer);
      const phone = normalizePhone(get(row, mapping, "phone")) ?? (get(row, mapping, "phone") || null);
      const emailRaw = get(row, mapping, "email");
      const email = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(emailRaw) ? emailRaw.toLowerCase() : null;
      let client = await findClient(tx, first, last, phone, email);
      if (!client) {
        const [nc] = await tx.insert(schema.clients).values({ businessId: business.id, firstName: first, lastName: last, phone, email, tags: ["imported"] }).returning();
        client = nc!;
      }
      const startAt = zonedToInstant(date, time, business.timezone);
      const status = statusMap[norm(get(row, mapping, "status"))] ?? (startAt < new Date() ? "completed" : "booked");
      const durationMin = parseDuration(get(row, mapping, "durationMin"));
      const timing = durationMin ? { durationMin, gapMin: 0, finishMin: 0, bufferAfterMin: 0 } : timingFor(service);
      const segments = buildBookingSegments(startAt, timing);
      const priceCents = money(get(row, mapping, "price")) ?? service.priceCents;
      // Skip exact duplicates (same client, staff, start).
      const dup = await tx
        .select({ id: schema.appointmentItems.id })
        .from(schema.appointmentItems)
        .innerJoin(schema.appointments, eq(schema.appointments.id, schema.appointmentItems.appointmentId))
        .where(and(eq(schema.appointments.clientId, client.id), eq(schema.appointmentItems.staffId, staff.id), eq(schema.appointmentItems.startAt, startAt)))
        .limit(1);
      if (dup.length) {
        r.skipped++;
        return;
      }
      // Pre-check overlaps so the (deferrable) exclusion constraint never has to fire mid-import.
      if (status !== "cancelled" && status !== "no_show") {
        for (const seg of segments) {
          const clash = await tx
            .select({ id: schema.appointmentItems.id })
            .from(schema.appointmentItems)
            .where(
              and(
                eq(schema.appointmentItems.staffId, staff.id),
                sql`${schema.appointmentItems.status} not in ('cancelled','no_show')`,
                sql`tstzrange(${schema.appointmentItems.startAt}, ${schema.appointmentItems.endAt}, '[)') && tstzrange(${seg.start.toISOString()}::timestamptz, ${seg.end.toISOString()}::timestamptz, '[)')`,
              ),
            )
            .limit(1);
          if (clash.length) {
            r.errors.push({ row: offset + i + 2, message: `Overlaps an existing booking for ${staff.displayName} at ${date} ${time}` });
            return;
          }
        }
      }
      const [appt] = await tx
        .insert(schema.appointments)
        .values({ businessId: business.id, clientId: client.id, status, source: "import", notes: get(row, mapping, "notes") || null, createdByUserId: actorUserId, locationId: staff.locationId ?? defaultLocationId })
        .returning({ id: schema.appointments.id });
      try {
        await tx.execute(sql`savepoint import_items`);
        await tx.insert(schema.appointmentItems).values(
          segments.map((seg, idx) => ({
            businessId: business.id,
            appointmentId: appt!.id,
            staffId: staff.id,
            serviceId: service!.id,
            serviceName: idx === 0 ? service!.name : `${service!.name} (finish)`,
            startAt: seg.start,
            endAt: seg.end,
            priceCents: idx === 0 ? priceCents : 0,
            status,
            sortOrder: idx,
          })),
        );
      } catch (e) {
        const code = (e as { code?: string; cause?: { code?: string } }).code ?? (e as { cause?: { code?: string } }).cause?.code;
        if (process.env.DEBUG_IMPORT) console.error("[import] items insert failed code=", code);
        if (code === "23P01") {
          await tx.execute(sql`rollback to savepoint import_items`);
          await tx.delete(schema.appointments).where(eq(schema.appointments.id, appt!.id));
          r.errors.push({ row: offset + i + 2, message: `Overlaps an existing booking for ${staff.displayName} at ${date} ${time}` });
          return;
        }
        throw e;
      }
      r.created++;
      if ((status === "booked" || status === "confirmed") && startAt > new Date()) upcoming.push(appt!.id);
      });
    } catch (e) {
      r.errors.push({ row: offset + i + 2, message: (e as Error).message });
    }
  }
}
