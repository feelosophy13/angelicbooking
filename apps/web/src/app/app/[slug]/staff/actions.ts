"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { headers } from "next/headers";
import { schema, withTenant } from "@angelic/db";
import { auth } from "@/lib/auth";
import { requireAction } from "@/lib/tenant";
import { f, formAction, FormError } from "@/lib/form";
import { setFlash } from "@/lib/flash";
import { queueOneOff } from "@/lib/notify";
import { listRoles } from "@/server/roles";
import { inviteEmail } from "@/lib/notify/templates";
import { ClockError, randomPin, setClockPin } from "@/server/time-clock";
import { deleteFileByUrl, FileError, storeImage } from "@/lib/files";

const timeRe = /^([01]\d|2[0-3]):[0-5]\d$/;

const profileSchema = z.object({
  slug: z.string(),
  staffId: z.string().optional(),
  displayName: f.text(1, 80),
  fullName: f.optional(120),
  email: f.email(),
  phone: f.optional(30),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/, "Pick a colour"),
  bio: f.optional(300),
  removePhoto: f.checkbox(),
  bookableOnline: f.checkbox(),
  takesAppointments: f.checkbox(),
  active: f.checkbox(),
  locationId: z.string().optional(),
  // Clock-in kiosk PIN: blank keeps the current one; "clearPin" removes it.
  clockPin: z.string().trim().optional(),
  clearPin: f.checkbox(),
});

export const createStaff = formAction(profileSchema, async (d) => {
  const ctx = await requireAction(d.slug, "staff.manage");
  const id = await withTenant(ctx.business.id, async (tx) => {
    const [row] = await tx
      .insert(schema.staff)
      .values({ businessId: ctx.business.id, displayName: d.displayName, fullName: d.fullName, email: d.email, phone: d.phone, color: d.color })
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

export const updateStaffProfile = formAction(profileSchema, async (d, raw) => {
  const ctx = await requireAction(d.slug, "staff.manage");
  if (!d.staffId) throw new FormError("Missing staff member.");
  const current = await withTenant(ctx.business.id, (tx) => tx.query.staff.findFirst({ where: eq(schema.staff.id, d.staffId!), columns: { photoUrl: true } }));
  // Photo: a new upload replaces the old file; "Remove photo" clears it.
  let photoUrl: string | null | undefined = undefined;
  const file = raw.get("photo");
  if (file instanceof File && file.size > 0) {
    try {
      photoUrl = (await storeImage(ctx.business.id, "staff", file)).url;
    } catch (e) {
      if (e instanceof FileError) throw new FormError(e.message, "photo");
      throw e;
    }
  } else if (d.removePhoto) photoUrl = null;
  await withTenant(ctx.business.id, (tx) =>
    tx
      .update(schema.staff)
      .set({ displayName: d.displayName, fullName: d.fullName, email: d.email, phone: d.phone, color: d.color, bio: d.bio, bookableOnline: d.bookableOnline && d.takesAppointments, takesAppointments: d.takesAppointments, active: d.active, locationId: d.locationId || null, ...(photoUrl !== undefined ? { photoUrl } : {}) })
      .where(eq(schema.staff.id, d.staffId!)),
  );
  if (photoUrl !== undefined && current?.photoUrl) await deleteFileByUrl(current.photoUrl);
  if (d.clearPin) await setClockPin(ctx.business.id, d.staffId, null);
  else if (d.clockPin) {
    try {
      await setClockPin(ctx.business.id, d.staffId, d.clockPin);
    } catch (e) {
      if (e instanceof ClockError) throw new FormError(e.message, "clockPin");
      throw e;
    }
  }
  revalidatePath(`/app/${d.slug}/staff`);
  revalidatePath(`/app/${d.slug}/staff/${d.staffId}`);
  return d.clockPin && !d.clearPin ? "Profile saved. Clock-in PIN set." : "Profile saved";
});

/** Pick a random PIN for the kiosk and show it once. */
export async function generateClockPin(formData: FormData) {
  const slug = String(formData.get("slug"));
  const staffId = String(formData.get("staffId"));
  const ctx = await requireAction(slug, "staff.manage");
  for (let i = 0; i < 20; i++) {
    const pin = randomPin();
    try {
      await setClockPin(ctx.business.id, staffId, pin);
      await setFlash(`Clock-in PIN is ${pin}. Write it down for them; it isn't shown again.`, "info");
      break;
    } catch (e) {
      if (!(e instanceof ClockError)) throw e;
    }
  }
  revalidatePath(`/app/${slug}/staff/${staffId}`);
}

export async function toggleStaffActive(formData: FormData) {
  const slug = String(formData.get("slug"));
  const ctx = await requireAction(slug, "staff.manage");
  const staffId = String(formData.get("staffId"));
  const active = formData.get("active") === "true";
  await withTenant(ctx.business.id, (tx) => tx.update(schema.staff).set({ active }).where(eq(schema.staff.id, staffId)));
  await setFlash(active ? "Staff member reactivated" : "Staff member deactivated");
  revalidatePath(`/app/${slug}/staff`);
}

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const blockSchema = z.object({ start: z.string().regex(timeRe), end: z.string().regex(timeRe) });

export async function saveSchedule(formData: FormData) {
  const slug = String(formData.get("slug"));
  const staffId = String(formData.get("staffId"));
  const ctx = await requireAction(slug, "staff.manage");
  // Any number of blocks per weekday (lunch break, split shift): start_{wd}_{i} / end_{wd}_{i}, plus one loc_{wd}.
  const days: { weekday: number; blocks: { start: string; end: string }[]; locationId: string | null }[] = [];
  for (let weekday = 0; weekday < 7; weekday++) {
    const blocks: { start: string; end: string }[] = [];
    if (formData.get(`on_${weekday}`) === "on") {
      for (let i = 0; i < 12 && formData.has(`start_${weekday}_${i}`); i++) {
        const parsed = blockSchema.safeParse({ start: String(formData.get(`start_${weekday}_${i}`) ?? ""), end: String(formData.get(`end_${weekday}_${i}`) ?? "") });
        if (!parsed.success) { await setFlash(`${DAY_NAMES[weekday]}: enter a start and end time for every block.`, "error"); return; }
        blocks.push(parsed.data);
      }
      if (!blocks.length) { await setFlash(`${DAY_NAMES[weekday]}: add at least one block or untick the day.`, "error"); return; }
    }
    blocks.sort((a, b) => a.start.localeCompare(b.start));
    for (let i = 0; i < blocks.length; i++) {
      const b = blocks[i]!;
      if (b.start >= b.end) { await setFlash(`${DAY_NAMES[weekday]}: start time must be before end time.`, "error"); return; }
      if (i > 0 && b.start < blocks[i - 1]!.end) { await setFlash(`${DAY_NAMES[weekday]}: blocks overlap.`, "error"); return; }
    }
    days.push({ weekday, blocks, locationId: (formData.get(`loc_${weekday}`) as string | null) || null });
  }

  await withTenant(ctx.business.id, async (tx) => {
    // Only locations of this business are accepted; a single-location business stores null (= the only one).
    const locs = await tx.select({ id: schema.locations.id }).from(schema.locations);
    const locId = (id: string | null) => (locs.length > 1 && id && locs.some((l) => l.id === id) ? id : null);
    await tx.delete(schema.staffSchedules).where(eq(schema.staffSchedules.staffId, staffId));
    const values = days.flatMap((d) => d.blocks.map((b) => ({ businessId: ctx.business.id, staffId, weekday: d.weekday, startTime: b.start, endTime: b.end, locationId: locId(d.locationId) })));
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
    // Optional last day: every date from `date` to `to` gets the same entry.
    to: z.string().optional().transform((v) => v || undefined),
    kind: z.enum(["off", "hours"]),
    start: z.string().optional(),
    end: z.string().optional(),
    note: f.optional(200),
  })
  .superRefine((o, ctx) => {
    if (o.to !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(o.to)) ctx.addIssue({ code: "custom", path: ["to"], message: "Pick a date" });
    else if (o.to && o.to < o.date) ctx.addIssue({ code: "custom", path: ["to"], message: "Must be on or after the first day" });
    else if (o.to && datesBetween(o.date, o.to).length > 366) ctx.addIssue({ code: "custom", path: ["to"], message: "At most a year at a time" });
    if (o.kind === "hours") {
      if (!o.start || !timeRe.test(o.start)) ctx.addIssue({ code: "custom", path: ["start"], message: "Pick a start time" });
      if (!o.end || !timeRe.test(o.end)) ctx.addIssue({ code: "custom", path: ["end"], message: "Pick an end time" });
      if (o.start && o.end && o.start >= o.end) ctx.addIssue({ code: "custom", path: ["end"], message: "End must be after start" });
    }
  });

/** Inclusive list of ISO dates from `from` to `to` (calendar days, no time zone involved). */
function datesBetween(from: string, to: string): string[] {
  const out: string[] = [];
  const d = new Date(from + "T00:00:00Z");
  const last = new Date(to + "T00:00:00Z");
  for (let i = 0; d <= last && i < 400; i++, d.setUTCDate(d.getUTCDate() + 1)) out.push(d.toISOString().slice(0, 10));
  return out;
}

export const addOverride = formAction(overrideSchema, async (o) => {
  const ctx = await requireAction(o.slug, "staff.manage");
  const dates = datesBetween(o.date, o.to ?? o.date);
  const fields = { isOff: o.kind === "off", startTime: o.kind === "hours" ? o.start! : null, endTime: o.kind === "hours" ? o.end! : null, note: o.note };
  await withTenant(ctx.business.id, (tx) =>
    tx
      .insert(schema.staffScheduleOverrides)
      .values(dates.map((date) => ({ businessId: ctx.business.id, staffId: o.staffId, date, ...fields })))
      .onConflictDoUpdate({ target: [schema.staffScheduleOverrides.businessId, schema.staffScheduleOverrides.staffId, schema.staffScheduleOverrides.date], set: fields }),
  );
  revalidatePath(`/app/${o.slug}/staff/${o.staffId}/time-off`);
  const span = dates.length > 1 ? ` for ${dates.length} days` : "";
  return o.kind === "off" ? `Time off added${span}` : `Custom hours added${span}`;
});

export async function deleteOverride(formData: FormData) {
  const slug = String(formData.get("slug"));
  const staffId = String(formData.get("staffId"));
  const ids = formData.getAll("overrideId").map(String).filter(Boolean);
  const ctx = await requireAction(slug, "staff.manage");
  if (ids.length) {
    await withTenant(ctx.business.id, (tx) =>
      tx.delete(schema.staffScheduleOverrides).where(and(eq(schema.staffScheduleOverrides.staffId, staffId), inArray(schema.staffScheduleOverrides.id, ids))),
    );
  }
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
      role: z.string().min(1),
      staffId: z.string().optional(),
    })
    .safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: "Enter a valid email and role." };
  const roles = await listRoles(ctx.business.id);
  if (!roles.some((r) => r.key === parsed.data.role) || parsed.data.role === "owner") return { error: "Pick a role from the list." };
  const h = await headers();
  try {
    const inv = await auth.api.createInvitation({
      headers: h,
      body: { email: parsed.data.email, role: parsed.data.role as "member", organizationId: ctx.business.id, resend: true },
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
            takesAppointments: parsed.data.role !== "front_desk",
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

/** Issue a new calendar-feed link for a staff member (the old link stops working). */
export async function resetCalendarToken(formData: FormData) {
  const d = z.object({ slug: z.string(), staffId: z.string().min(1) }).parse(Object.fromEntries(formData));
  const ctx = await requireAction(d.slug, "staff.manage");
  const bytes = new Uint8Array(18);
  crypto.getRandomValues(bytes);
  await withTenant(ctx.business.id, (tx) => tx.update(schema.staff).set({ calendarToken: Buffer.from(bytes).toString("hex") }).where(eq(schema.staff.id, d.staffId)));
  await setFlash("Calendar link reset. Subscribe again with the new link.");
  revalidatePath(`/app/${d.slug}/staff/${d.staffId}`);
}
