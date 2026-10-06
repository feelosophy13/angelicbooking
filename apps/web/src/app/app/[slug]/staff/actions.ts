"use server";
import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { headers } from "next/headers";
import { schema, withTenant } from "@angelic/db";
import { parseMoney } from "@angelic/core";
import { auth } from "@/lib/auth";
import { requireAction } from "@/lib/tenant";
import { queueOneOff } from "@/lib/notify";
import { inviteEmail } from "@/lib/notify/templates";

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

// ---------------------------------------------------------------------------
// Days off / custom hours
// ---------------------------------------------------------------------------
const overrideSchema = z
  .object({
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    kind: z.enum(["off", "hours"]),
    start: z.string().regex(timeRe).optional().or(z.literal("")),
    end: z.string().regex(timeRe).optional().or(z.literal("")),
    note: z.string().trim().max(200).optional(),
  })
  .refine((o) => o.kind === "off" || (o.start && o.end && o.start < o.end), { message: "Custom hours need a start before the end." });

export async function addOverride(formData: FormData) {
  const slug = String(formData.get("slug"));
  const staffId = String(formData.get("staffId"));
  const ctx = await requireAction(slug, "staff.manage");
  const o = overrideSchema.parse(Object.fromEntries(formData));
  await withTenant(ctx.business.id, (tx) =>
    tx
      .insert(schema.staffScheduleOverrides)
      .values({
        businessId: ctx.business.id,
        staffId,
        date: o.date,
        isOff: o.kind === "off",
        startTime: o.kind === "hours" ? o.start! : null,
        endTime: o.kind === "hours" ? o.end! : null,
        note: o.note || null,
      })
      .onConflictDoUpdate({
        target: [schema.staffScheduleOverrides.businessId, schema.staffScheduleOverrides.staffId, schema.staffScheduleOverrides.date],
        set: {
          isOff: o.kind === "off",
          startTime: o.kind === "hours" ? o.start! : null,
          endTime: o.kind === "hours" ? o.end! : null,
          note: o.note || null,
        },
      }),
  );
  revalidatePath(`/app/${slug}/staff/${staffId}`);
}

export async function deleteOverride(formData: FormData) {
  const slug = String(formData.get("slug"));
  const staffId = String(formData.get("staffId"));
  const overrideId = String(formData.get("overrideId"));
  const ctx = await requireAction(slug, "staff.manage");
  await withTenant(ctx.business.id, (tx) =>
    tx.delete(schema.staffScheduleOverrides).where(eq(schema.staffScheduleOverrides.id, overrideId)),
  );
  revalidatePath(`/app/${slug}/staff/${staffId}`);
}

// ---------------------------------------------------------------------------
// Invitations (Better Auth). No email provider yet: we surface a copyable link.
// ---------------------------------------------------------------------------
export async function inviteStaff(_prev: InviteState, formData: FormData): Promise<InviteState> {
  const slug = String(formData.get("slug"));
  const ctx = await requireAction(slug, "members.manage");
  const parsed = z
    .object({
      email: z.string().trim().toLowerCase().email(),
      role: z.enum(["manager", "provider", "front_desk"]),
      staffId: z.string().optional(),
    })
    .safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: "Enter a valid email and role." };
  const h = await headers();
  try {
    const inv = await auth.api.createInvitation({
      headers: h,
      body: { email: parsed.data.email, role: parsed.data.role, organizationId: ctx.business.id, resend: true },
    });
    // Pre-create / tag the staff row so the invitee lands on the calendar once they accept.
    await withTenant(ctx.business.id, async (tx) => {
      const existing = await tx.query.staff.findFirst({ where: eq(schema.staff.email, parsed.data.email) });
      if (!existing) {
        const [row] = await tx
          .insert(schema.staff)
          .values({
            businessId: ctx.business.id,
            displayName: parsed.data.email.split("@")[0]!,
            email: parsed.data.email,
            bookableOnline: parsed.data.role === "provider",
          })
          .returning({ id: schema.staff.id });
        // Default hours so they are bookable as soon as they accept; editable under Staff.
        await tx.insert(schema.staffSchedules).values(
          [2, 3, 4, 5, 6].map((weekday) => ({ businessId: ctx.business.id, staffId: row!.id, weekday, startTime: "09:00", endTime: "17:00" })),
        );
      }
    });
    const mail = inviteEmail({ businessName: ctx.business.name, role: parsed.data.role, link: inviteLink(inv.id) });
    await queueOneOff(ctx.business.id, { channel: "email", template: "invite", recipient: parsed.data.email, subject: mail.subject, body: mail.html });
    revalidatePath(`/app/${slug}/staff`);
    return { ok: true, link: inviteLink(inv.id) };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Could not create invitation" };
  }
}

export async function cancelInvite(formData: FormData) {
  const slug = String(formData.get("slug"));
  await requireAction(slug, "members.manage");
  const invitationId = String(formData.get("invitationId"));
  await auth.api.cancelInvitation({ headers: await headers(), body: { invitationId } });
  revalidatePath(`/app/${slug}/staff`);
}

export type InviteState = { error?: string; ok?: boolean; link?: string } | undefined;

function inviteLink(id: string) {
  return `${process.env.NEXT_PUBLIC_APP_URL ?? ""}/invite/${id}`;
}

// ---------------------------------------------------------------------------
// Pay configuration
// ---------------------------------------------------------------------------
const pct = z.string().trim().transform((v) => (v === "" ? 0 : Math.round(Number(v) * 100))).refine((n) => Number.isFinite(n) && n >= 0 && n <= 10_000, "Enter a percent between 0 and 100");
const moneyOpt = z.string().trim().transform((v) => (v === "" ? null : parseMoney(v))).refine((n) => n === null || n !== null, "Enter an amount");

export async function savePay(formData: FormData) {
  const slug = String(formData.get("slug"));
  const staffId = String(formData.get("staffId"));
  const ctx = await requireAction(slug, "members.manage");
  const d = z
    .object({
      position: z.string().trim().max(60),
      payType: z.enum(["commission", "hourly", "salary"]),
      mainCommissionPct: pct,
      productCommissionPct: pct,
      ccTipFeePct: pct,
      hourlyRate: moneyOpt,
      salaryPerPeriod: moneyOpt,
      overtimeOverride: z.enum(["default", "yes", "no"]),
      taxDeductionAmount: moneyOpt,
      taxDeductionPct: z.string().trim(),
    })
    .parse(Object.fromEntries(formData));
  const taxBps = d.taxDeductionPct === "" ? null : Math.round(Number(d.taxDeductionPct) * 100);
  await withTenant(ctx.business.id, (tx) =>
    tx
      .update(schema.staff)
      .set({
        position: d.position || null,
        payType: d.payType,
        mainCommissionBps: d.mainCommissionPct,
        productCommissionBps: d.productCommissionPct,
        ccTipFeeBps: d.ccTipFeePct,
        hourlyRateCents: d.hourlyRate ?? 0,
        salaryPerPeriodCents: d.salaryPerPeriod ?? 0,
        overtimeOverride: d.overtimeOverride === "default" ? null : d.overtimeOverride === "yes",
        taxDeductionCents: d.taxDeductionAmount,
        taxDeductionBps: Number.isFinite(taxBps as number) ? taxBps : null,
      })
      .where(eq(schema.staff.id, staffId)),
  );
  revalidatePath(`/app/${slug}/staff/${staffId}`);
}
