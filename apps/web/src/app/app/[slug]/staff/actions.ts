"use server";
import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { schema, withTenant } from "@angelic/db";
import { requireAction } from "@/lib/tenant";

const timeRe = /^([01]\d|2[0-3]):[0-5]\d$/;

const createSchema = z.object({
  displayName: z.string().trim().min(1).max(80),
  email: z.string().trim().email().or(z.literal("")).transform((v) => v || null),
  phone: z.string().trim().max(30).transform((v) => v || null),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
});

export async function createStaff(formData: FormData) {
  const slug = String(formData.get("slug"));
  const ctx = await requireAction(slug, "staff.manage");
  const data = createSchema.parse(Object.fromEntries(formData));
  await withTenant(ctx.business.id, async (tx) => {
    const [row] = await tx.insert(schema.staff).values({ businessId: ctx.business.id, ...data }).returning({ id: schema.staff.id });
    // Default schedule: Tue–Sat 9–5. Editable immediately after.
    await tx.insert(schema.staffSchedules).values(
      [2, 3, 4, 5, 6].map((weekday) => ({ businessId: ctx.business.id, staffId: row!.id, weekday, startTime: "09:00", endTime: "17:00" })),
    );
  });
  revalidatePath(`/app/${slug}/staff`);
}

export async function toggleStaffActive(formData: FormData) {
  const slug = String(formData.get("slug"));
  const ctx = await requireAction(slug, "staff.manage");
  const staffId = String(formData.get("staffId"));
  const active = formData.get("active") === "true";
  await withTenant(ctx.business.id, (tx) => tx.update(schema.staff).set({ active }).where(eq(schema.staff.id, staffId)));
  revalidatePath(`/app/${slug}/staff`);
}

const scheduleSchema = z.array(
  z.object({
    weekday: z.number().int().min(0).max(6),
    on: z.boolean(),
    start: z.string().regex(timeRe),
    end: z.string().regex(timeRe),
  }),
);

export async function saveSchedule(formData: FormData) {
  const slug = String(formData.get("slug"));
  const staffId = String(formData.get("staffId"));
  const ctx = await requireAction(slug, "staff.manage");
  const rows = scheduleSchema.parse(
    Array.from({ length: 7 }, (_, weekday) => ({
      weekday,
      on: formData.get(`on_${weekday}`) === "on",
      start: String(formData.get(`start_${weekday}`) ?? "09:00"),
      end: String(formData.get(`end_${weekday}`) ?? "17:00"),
    })),
  );
  for (const r of rows) if (r.on && r.start >= r.end) throw new Error("Start time must be before end time.");

  await withTenant(ctx.business.id, async (tx) => {
    await tx.delete(schema.staffSchedules).where(eq(schema.staffSchedules.staffId, staffId));
    const values = rows.filter((r) => r.on).map((r) => ({ businessId: ctx.business.id, staffId, weekday: r.weekday, startTime: r.start, endTime: r.end }));
    if (values.length) await tx.insert(schema.staffSchedules).values(values);
  });
  revalidatePath(`/app/${slug}/staff/${staffId}`);
}

export async function saveStaffServices(formData: FormData) {
  const slug = String(formData.get("slug"));
  const staffId = String(formData.get("staffId"));
  const ctx = await requireAction(slug, "staff.manage");
  const serviceIds = formData.getAll("serviceIds").map(String);
  await withTenant(ctx.business.id, async (tx) => {
    await tx.delete(schema.staffServices).where(and(eq(schema.staffServices.staffId, staffId)));
    if (serviceIds.length) {
      await tx.insert(schema.staffServices).values(serviceIds.map((serviceId) => ({ businessId: ctx.business.id, staffId, serviceId })));
    }
  });
  revalidatePath(`/app/${slug}/staff/${staffId}`);
}
