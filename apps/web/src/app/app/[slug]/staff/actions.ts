"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { headers } from "next/headers";
import { schema, withTenant } from "@angelic/db";
import { auth } from "@/lib/auth";
import { requireAction } from "@/lib/tenant";
import { f, formAction, FormError } from "@/lib/form";
import { setFlash } from "@/lib/flash";
import { queueOneOff } from "@/lib/notify";
import { inviteEmail } from "@/lib/notify/templates";

const timeRe = /^([01]\d|2[0-3]):[0-5]\d$/;

const profileSchema = z.object({
  slug: z.string(),
  staffId: z.string().optional(),
  displayName: f.text(1, 80),
  email: f.email(),
  phone: f.optional(30),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/, "Pick a colour"),
  bookableOnline: f.checkbox(),
  active: f.checkbox(),
  locationId: z.string().optional(),
});

export const createStaff = formAction(profileSchema, async (d) => {
  const ctx = await requireAction(d.slug, "staff.manage");
  const id = await withTenant(ctx.business.id, async (tx) => {
    const [row] = await tx
      .insert(schema.staff)
      .values({ businessId: ctx.business.id, displayName: d.displayName, email: d.email, phone: d.phone, color: d.color })
      .returning({ id: schema.staff.id });
    // Default schedule: Tue–Sat 9–5. Editable immediately after.
    await tx.insert(schema.staffSchedules).values(
      [2, 3, 4, 5, 6].map((weekday) => ({ businessId: ctx.business.id, staffId: row!.id, weekday, startTime: "09:00", endTime: "17:00" })),
    );
    return row!.id;
  });
  await setFlash(`${d.displayName} added. Set their hours next.`);
  revalidatePath(`/app/${d.slug}/staff`);
  redirect(`/app/${d.slug}/staff/${id}/hours`);
});

export const updateStaffProfile = formAction(profileSchema, async (d) => {
  const ctx = await requireAction(d.slug, "staff.manage");
  if (!d.staffId) throw new FormError("Missing staff member.");
  await withTenant(ctx.business.id, (tx) =>
    tx
      .update(schema.staff)
      .set({ displayName: d.displayName, email: d.email, phone: d.phone, color: d.color, bookableOnline: d.bookableOnline, active: d.active, locationId: d.locationId || null })
      .where(eq(schema.staff.id, d.staffId!)),
  );
  revalidatePath(`/app/${d.slug}/staff`);
  revalidatePath(`/app/${d.slug}/staff/${d.staffId}`);
  return "Profile saved";
});

export async function toggleStaffActive(formData: FormData) {
  const slug = String(formData.get("slug"));
  const ctx = await requireAction(slug, "staff.manage");
  const staffId = String(formData.get("staffId"));
  const active = formData.get("active") === "true";
  await withTenant(ctx.business.id, (tx) => tx.update(schema.staff).set({ active }).where(eq(schema.staff.id, staffId)));
  await setFlash(active ? "Staff member reactivated" : "Staff member deactivated");
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
  for (const r of rows) if (r.on && r.start >= r.end) { await setFlash("Start time must be before end time.", "error"); return; }

  await withTenant(ctx.business.id, async (tx) => {
    await tx.delete(schema.staffSchedules).where(eq(schema.staffSchedules.staffId, staffId));
    const values = rows.filter((r) => r.on).map((r) => ({ businessId: ctx.business.id, staffId, weekday: r.weekday, startTime: r.start, endTime: r.end }));
    if (values.length) await tx.insert(schema.staffSchedules).values(values);
  });
  await setFlash("Hours saved");
  revalidatePath(`/app/${slug}/staff/${staffId}/hours`);
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
  await setFlash("Services saved");
  revalidatePath(`/app/${slug}/staff/${staffId}/services`);
}

// ---------------------------------------------------------------------------
// Days off / custom hours
// ---------------------------------------------------------------------------
const overrideSchema = z
  .object({
    slug: z.string(),
    staffId: z.string(),
    date: f.isoDate(),
    kind: z.enum(["off", "hours"]),
    start: z.string().optional(),
    end: z.string().optional(),
    note: f.optional(200),
  })
  .superRefine((o, ctx) => {
    if (o.kind === "hours") {
      if (!o.start || !timeRe.test(o.start)) ctx.addIssue({ code: "custom", path: ["start"], message: "Pick a start time" });
      if (!o.end || !timeRe.test(o.end)) ctx.addIssue({ code: "custom", path: ["end"], message: "Pick an end time" });
      if (o.start && o.end && o.start >= o.end) ctx.addIssue({ code: "custom", path: ["end"], message: "End must be after start" });
    }
  });

export const addOverride = formAction(overrideSchema, async (o) => {
  const ctx = await requireAction(o.slug, "staff.manage");
  await withTenant(ctx.business.id, (tx) =>
    tx
      .insert(schema.staffScheduleOverrides)
      .values({ businessId: ctx.business.id, staffId: o.staffId, date: o.date, isOff: o.kind === "off", startTime: o.kind === "hours" ? o.start! : null, endTime: o.kind === "hours" ? o.end! : null, note: o.note })
      .onConflictDoUpdate({
        target: [schema.staffScheduleOverrides.businessId, schema.staffScheduleOverrides.staffId, schema.staffScheduleOverrides.date],
        set: { isOff: o.kind === "off", startTime: o.kind === "hours" ? o.start! : null, endTime: o.kind === "hours" ? o.end! : null, note: o.note },
      }),
  );
  revalidatePath(`/app/${o.slug}/staff/${o.staffId}/time-off`);
  return o.kind === "off" ? "Day off added" : "Custom hours added";
});

export async function deleteOverride(formData: FormData) {
  const slug = String(formData.get("slug"));
  const staffId = String(formData.get("staffId"));
  const overrideId = String(formData.get("overrideId"));
  const ctx = await requireAction(slug, "staff.manage");
  await withTenant(ctx.business.id, (tx) =>
    tx.delete(schema.staffScheduleOverrides).where(eq(schema.staffScheduleOverrides.id, overrideId)),
  );
  await setFlash("Removed");
  revalidatePath(`/app/${slug}/staff/${staffId}/time-off`);
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
    revalidatePath(`/app/${slug}/staff/invitations`);
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
  revalidatePath(`/app/${slug}/staff/invitations`);
}

export type InviteState = { error?: string; ok?: boolean; link?: string } | undefined;

function inviteLink(id: string) {
  return `${process.env.NEXT_PUBLIC_APP_URL ?? ""}/invite/${id}`;
}

// ---------------------------------------------------------------------------
// Pay configuration
// ---------------------------------------------------------------------------
const pct = z.string().trim().transform((v) => (v === "" ? 0 : Math.round(Number(v) * 100))).refine((n) => Number.isFinite(n) && n >= 0 && n <= 10_000, "Enter a percent between 0 and 100");

export const savePay = formAction(
  z.object({
    slug: z.string(),
    staffId: z.string(),
    position: f.optional(60),
    payType: z.enum(["commission", "hourly", "salary"]),
    mainCommissionPct: pct,
    productCommissionPct: pct,
    ccTipFeePct: pct,
    hourlyRate: f.moneyOptional(),
    salaryPerPeriod: f.moneyOptional(),
    overtimeOverride: z.enum(["default", "yes", "no"]),
    taxDeductionAmount: z.string().trim().regex(/^(\d{1,7}(\.\d{1,2})?)?$/, "Enter an amount like 48.30").transform((v) => (v ? Math.round(Number(v) * 100) : null)),
    taxDeductionPct: z.string().trim().regex(/^(\d{1,2}(\.\d{1,2})?)?$/, "Enter a percent").transform((v) => (v ? Math.round(Number(v) * 100) : null)),
  }),
  async (d) => {
    const ctx = await requireAction(d.slug, "members.manage");
    if (d.payType === "hourly" && !d.hourlyRate) throw new FormError("Enter an hourly rate", "hourlyRate");
    if (d.payType === "salary" && !d.salaryPerPeriod) throw new FormError("Enter the salary per period", "salaryPerPeriod");
    await withTenant(ctx.business.id, (tx) =>
      tx
        .update(schema.staff)
        .set({
          position: d.position,
          payType: d.payType,
          mainCommissionBps: d.mainCommissionPct,
          productCommissionBps: d.productCommissionPct,
          ccTipFeeBps: d.ccTipFeePct,
          hourlyRateCents: d.hourlyRate,
          salaryPerPeriodCents: d.salaryPerPeriod,
          overtimeOverride: d.overtimeOverride === "default" ? null : d.overtimeOverride === "yes",
          taxDeductionCents: d.taxDeductionAmount,
          taxDeductionBps: d.taxDeductionPct,
        })
        .where(eq(schema.staff.id, d.staffId)),
    );
    revalidatePath(`/app/${d.slug}/staff/${d.staffId}/pay`);
    return "Pay settings saved";
  },
);
