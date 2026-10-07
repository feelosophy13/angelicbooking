"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { schema, withTenant } from "@angelic/db";
import { instantToISODate } from "@angelic/core";
import { requireBusiness, requireAction } from "@/lib/tenant";

async function ownStaffId(businessId: string, userId: string) {
  return withTenant(businessId, async (tx) => (await tx.query.staff.findFirst({ where: eq(schema.staff.userId, userId) }))?.id ?? null);
}

/** Clock in / out for the signed-in user's own staff row. */
export async function clockToggle(formData: FormData) {
  const slug = String(formData.get("slug"));
  const ctx = await requireBusiness(slug);
  const staffId = await ownStaffId(ctx.business.id, ctx.user.id);
  if (!staffId) throw new Error("You are not set up as a staff member here.");
  const now = new Date();
  await withTenant(ctx.business.id, async (tx) => {
    const open = await tx.query.timeEntries.findFirst({ where: and(eq(schema.timeEntries.staffId, staffId), isNull(schema.timeEntries.clockOutAt), eq(schema.timeEntries.minutes, 0)) });
    if (open && open.clockInAt) {
      const minutes = Math.max(1, Math.round((now.getTime() - open.clockInAt.getTime()) / 60_000));
      await tx.update(schema.timeEntries).set({ clockOutAt: now, minutes }).where(eq(schema.timeEntries.id, open.id));
    } else {
      await tx.insert(schema.timeEntries).values({ businessId: ctx.business.id, staffId, date: instantToISODate(now, ctx.business.timezone), minutes: 0, clockInAt: now, createdByUserId: ctx.user.id });
    }
  });
  revalidatePath(`/app/${slug}/time`);
}

export async function addTimeEntry(formData: FormData) {
  const d = z
    .object({ slug: z.string(), staffId: z.string().min(1), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), hours: z.coerce.number().min(0).max(24), note: z.string().trim().max(120).optional() })
    .parse(Object.fromEntries(formData));
  const ctx = await requireAction(d.slug, "staff.manage");
  await withTenant(ctx.business.id, (tx) =>
    tx.insert(schema.timeEntries).values({ businessId: ctx.business.id, staffId: d.staffId, date: d.date, minutes: Math.round(d.hours * 60), note: d.note || null, createdByUserId: ctx.user.id }),
  );
  revalidatePath(`/app/${d.slug}/time`);
  redirect(`/app/${d.slug}/time`);
}

export async function deleteTimeEntry(formData: FormData) {
  const d = z.object({ slug: z.string(), id: z.string().min(1) }).parse(Object.fromEntries(formData));
  const ctx = await requireAction(d.slug, "staff.manage");
  await withTenant(ctx.business.id, (tx) => tx.delete(schema.timeEntries).where(eq(schema.timeEntries.id, d.id)));
  revalidatePath(`/app/${d.slug}/time`);
}
