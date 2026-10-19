"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { schema, withTenant } from "@angelic/db";
import { instantToISODate } from "@angelic/core";
import { requireBusiness, requireAction } from "@/lib/tenant";
import { f, formAction, FormError } from "@/lib/form";
import { setFlash } from "@/lib/flash";
import { ClockError, assertPunchOpen, openEntryFor, resetClockToken } from "@/server/time-clock";
import { assertPeriodOpen, PayrollLockedError } from "@/server/payroll-lock";

async function ownStaffId(businessId: string, userId: string) {
  return withTenant(businessId, async (tx) => (await tx.query.staff.findFirst({ where: eq(schema.staff.userId, userId) }))?.id ?? null);
}

/** Clock in / out for the signed-in user's own staff row. */
export async function clockToggle(formData: FormData) {
  const slug = String(formData.get("slug"));
  const ctx = await requireBusiness(slug);
  const staffId = await ownStaffId(ctx.business.id, ctx.user.id);
  if (!staffId) return setFlash("You are not set up as a staff member here.", "error");
  const now = new Date();
  let out: boolean;
  try {
    out = await withTenant(ctx.business.id, async (tx) => {
      const open = await openEntryFor(tx, staffId, now);
      if (open && open.clockInAt) {
        await assertPunchOpen(tx, open.date);
        const minutes = Math.max(1, Math.round((now.getTime() - open.clockInAt.getTime()) / 60_000));
        await tx.update(schema.timeEntries).set({ clockOutAt: now, minutes }).where(eq(schema.timeEntries.id, open.id));
        return true;
      }
      await assertPunchOpen(tx, instantToISODate(now, ctx.business.timezone));
      // Recorded at their usual site (else the default), so location reports and pay by site include web clock-ins.
      const person = await tx.query.staff.findFirst({ where: eq(schema.staff.id, staffId), columns: { locationId: true } });
      const site = person?.locationId ?? (await tx.query.locations.findFirst({ where: eq(schema.locations.isDefault, true), columns: { id: true } }))?.id ?? null;
      await tx.insert(schema.timeEntries).values({ businessId: ctx.business.id, staffId, date: instantToISODate(now, ctx.business.timezone), minutes: 0, clockInAt: now, locationId: site, createdByUserId: ctx.user.id });
      return false;
    });
  } catch (e) {
    if (e instanceof ClockError) return setFlash(e.message, "error");
    throw e;
  }
  await setFlash(out ? "Clocked out" : "Clocked in");
  revalidatePath(`/app/${slug}/time`);
}

export const addTimeEntry = formAction(
  z.object({ slug: z.string(), staffId: f.id(), date: f.isoDate(), hours: f.num(0.25, 24), note: f.optional(120) }),
  async (d) => {
    const ctx = await requireAction(d.slug, "time.edit");
    try {
      await withTenant(ctx.business.id, async (tx) => {
        await assertPeriodOpen(tx, d.date, "Hours");
        const [row] = await tx.insert(schema.timeEntries).values({ businessId: ctx.business.id, staffId: d.staffId, date: d.date, minutes: Math.round(d.hours * 60), note: d.note, createdByUserId: ctx.user.id }).returning({ id: schema.timeEntries.id });
        await tx.insert(schema.auditLog).values({ businessId: ctx.business.id, actorUserId: ctx.user.id, action: "time_entry.add", entity: "time_entry", entityId: row!.id, diff: JSON.stringify({ staffId: d.staffId, date: d.date, minutes: Math.round(d.hours * 60) }) });
      });
    } catch (e) {
      if (e instanceof PayrollLockedError) throw new FormError(e.message, "date");
      throw e;
    }
    await setFlash("Hours added");
    revalidatePath(`/app/${d.slug}/time`);
    redirect(`/app/${d.slug}/time`);
  },
);

export async function deleteTimeEntry(formData: FormData) {
  const d = z.object({ slug: z.string(), id: z.string().min(1) }).parse(Object.fromEntries(formData));
  const ctx = await requireAction(d.slug, "time.edit");
  try {
    await withTenant(ctx.business.id, async (tx) => {
      const entry = await tx.query.timeEntries.findFirst({ where: eq(schema.timeEntries.id, d.id) });
      if (entry) await assertPeriodOpen(tx, entry.date, "This entry");
      await tx.delete(schema.timeEntries).where(eq(schema.timeEntries.id, d.id));
      if (entry) await tx.insert(schema.auditLog).values({ businessId: ctx.business.id, actorUserId: ctx.user.id, action: "time_entry.remove", entity: "time_entry", entityId: entry.id, diff: JSON.stringify({ staffId: entry.staffId, date: entry.date, minutes: entry.minutes, note: entry.note }) });
    });
  } catch (e) {
    if (e instanceof PayrollLockedError) {
      await setFlash(e.message, "error");
      return;
    }
    throw e;
  }
  await setFlash("Entry removed");
  revalidatePath(`/app/${d.slug}/time`);
}

/** Invalidate a location's printed QR code and issue a new one. */
export async function rotateClockToken(formData: FormData) {
  const d = z.object({ slug: z.string(), locationId: z.string().min(1) }).parse(Object.fromEntries(formData));
  const ctx = await requireAction(d.slug, "staff.manage");
  await resetClockToken(ctx.business.id, d.locationId);
  await setFlash("New clock-in code issued. Reprint the QR code; the old one no longer works.");
  revalidatePath(`/app/${d.slug}/time`);
}

/** Correct an entry's hours or note (a forgotten clock-out, a wrong punch) instead of deleting and re-adding it. Logged with before/after. */
export async function editTimeEntry(formData: FormData) {
  const d = z.object({ slug: z.string(), id: z.string().min(1), hours: z.coerce.number().min(0).max(24), note: z.string().trim().max(120).optional() }).safeParse(Object.fromEntries(formData));
  if (!d.success) {
    await setFlash("Enter hours between 0 and 24.", "error");
    return;
  }
  const ctx = await requireAction(d.data.slug, "time.edit");
  try {
    await withTenant(ctx.business.id, async (tx) => {
      const e = await tx.query.timeEntries.findFirst({ where: eq(schema.timeEntries.id, d.data.id) });
      if (!e) return;
      await assertPeriodOpen(tx, e.date, "This entry");
      const minutes = Math.round(d.data.hours * 60);
      const note = d.data.note || null;
      await tx.update(schema.timeEntries).set({ minutes, note, ...(e.clockInAt ? { clockOutAt: new Date(e.clockInAt.getTime() + minutes * 60_000) } : {}) }).where(eq(schema.timeEntries.id, e.id));
      await tx.insert(schema.auditLog).values({ businessId: ctx.business.id, actorUserId: ctx.user.id, action: "time_entry.edit", entity: "time_entry", entityId: e.id, diff: JSON.stringify({ staffId: e.staffId, date: e.date, before: { minutes: e.minutes, note: e.note }, after: { minutes, note } }) });
    });
  } catch (e) {
    if (e instanceof PayrollLockedError) {
      await setFlash(e.message, "error");
      return;
    }
    throw e;
  }
  await setFlash("Entry updated");
  revalidatePath(`/app/${d.data.slug}/time`);
}
