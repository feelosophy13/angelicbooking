"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, asc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { headers } from "next/headers";
import { schema, withTenant } from "@angelic/db";
import { instantToISODate, isAction, mondayOf, worksOwnCalendar } from "@angelic/core";
import { shiftISODate } from "@/lib/utils";
import { auth } from "@/lib/auth";
import { requireAction, roleActor } from "@/lib/tenant";
import { f, formAction, FormError } from "@/lib/form";
import { setFlash } from "@/lib/flash";
import { queueOneOff } from "@/lib/notify";
import { assertMayAssignRole, listRoles, RoleError } from "@/server/roles";
import { inviteEmail } from "@/lib/notify/templates";
import { ClockError, randomPin, setClockPin } from "@/server/time-clock";
import { deleteFileByUrl, FileError, storeImage } from "@/lib/files";
import { recordPayChange } from "@/server/pay-rates";
import { applyStaffServices, parseMinutesField, parsePriceField, TermError } from "@/server/stylist-pricing";
import { PayrollLockedError } from "@/server/payroll-lock";

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
  position: f.optional(60),
  removePhoto: f.checkbox(),
  removeWork0: f.checkbox(),
  removeWork1: f.checkbox(),
  removeWork2: f.checkbox(),
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
  const current = await withTenant(ctx.business.id, (tx) => tx.query.staff.findFirst({ where: eq(schema.staff.id, d.staffId!), columns: { photoUrl: true, workPhotoUrls: true } }));
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
  // Work photos: three slots; a new file replaces that slot, "remove" empties it, the rest keep their place.
  const slots: (string | null)[] = [0, 1, 2].map((i) => current?.workPhotoUrls?.[i] ?? null);
  const removedFiles: string[] = [];
  for (const i of [0, 1, 2]) {
    const wf = raw.get(`work${i}`);
    if (wf instanceof File && wf.size > 0) {
      try {
        const url = (await storeImage(ctx.business.id, "staff", wf)).url;
        if (slots[i]) removedFiles.push(slots[i]!);
        slots[i] = url;
      } catch (e) {
        if (e instanceof FileError) throw new FormError(e.message, `work${i}`);
        throw e;
      }
    } else if (d[`removeWork${i}` as "removeWork0" | "removeWork1" | "removeWork2"]) {
      if (slots[i]) removedFiles.push(slots[i]!);
      slots[i] = null;
    }
  }
  const workPhotoUrls = slots.filter((u): u is string => !!u);
  await withTenant(ctx.business.id, (tx) =>
    tx
      .update(schema.staff)
      .set({ workPhotoUrls, displayName: d.displayName, fullName: d.fullName, email: d.email, phone: d.phone, color: d.color, bio: d.bio, position: d.position, bookableOnline: d.bookableOnline && d.takesAppointments, takesAppointments: d.takesAppointments, active: d.active, locationId: d.locationId || null, ...(photoUrl !== undefined ? { photoUrl } : {}) })
      .where(eq(schema.staff.id, d.staffId!)),
  );
  if (photoUrl !== undefined && current?.photoUrl) await deleteFileByUrl(current.photoUrl);
  for (const u of removedFiles) await deleteFileByUrl(u);
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
  // Hours repeat every `rotationWeeks` weeks (1–4). Per week w and weekday: on_{w}_{wd}, loc_{w}_{wd}, and any
  // number of blocks start_{w}_{wd}_{i} / end_{w}_{wd}_{i} (lunch break, split shift).
  const rotationWeeks = Math.min(4, Math.max(1, Number(formData.get("rotationWeeks")) || 1));
  const thisWeekIs = Math.min(rotationWeeks - 1, Math.max(0, Number(formData.get("thisWeekIs")) || 0));
  const days: { weekIndex: number; weekday: number; blocks: { start: string; end: string }[]; locationId: string | null }[] = [];
  for (let w = 0; w < rotationWeeks; w++) {
    for (let weekday = 0; weekday < 7; weekday++) {
      const label = rotationWeeks > 1 ? `Week ${w + 1} ${DAY_NAMES[weekday]}` : DAY_NAMES[weekday];
      const blocks: { start: string; end: string }[] = [];
      if (formData.get(`on_${w}_${weekday}`) === "on") {
        for (let i = 0; i < 12 && formData.has(`start_${w}_${weekday}_${i}`); i++) {
          const parsed = blockSchema.safeParse({ start: String(formData.get(`start_${w}_${weekday}_${i}`) ?? ""), end: String(formData.get(`end_${w}_${weekday}_${i}`) ?? "") });
          if (!parsed.success) { await setFlash(`${label}: enter a start and end time for every block.`, "error"); return; }
          blocks.push(parsed.data);
        }
        if (!blocks.length) { await setFlash(`${label}: add at least one block or untick the day.`, "error"); return; }
      }
      blocks.sort((a, b) => a.start.localeCompare(b.start));
      for (let i = 0; i < blocks.length; i++) {
        const b = blocks[i]!;
        if (b.start >= b.end) { await setFlash(`${label}: start time must be before end time.`, "error"); return; }
        if (i > 0 && b.start < blocks[i - 1]!.end) { await setFlash(`${label}: blocks overlap.`, "error"); return; }
      }
      days.push({ weekIndex: w, weekday, blocks, locationId: (formData.get(`loc_${w}_${weekday}`) as string | null) || null });
    }
  }
  // The anchor is the Monday of a "Week 1" week: this week's Monday, moved back by however many weeks into the
  // cycle the user says this week is.
  const monday = mondayOf(instantToISODate(new Date(), ctx.business.timezone));
  const rotationAnchor = rotationWeeks > 1 ? shiftISODate(monday, -7 * thisWeekIs) : null;

  await withTenant(ctx.business.id, async (tx) => {
    // Only locations of this business are accepted; a single-location business stores null (= the only one).
    const locs = await tx.select({ id: schema.locations.id }).from(schema.locations);
    const locId = (id: string | null) => (locs.length > 1 && id && locs.some((l) => l.id === id) ? id : null);
    await tx.delete(schema.staffSchedules).where(eq(schema.staffSchedules.staffId, staffId));
    const values = days.flatMap((d) => d.blocks.map((b) => ({ businessId: ctx.business.id, staffId, weekIndex: d.weekIndex, weekday: d.weekday, startTime: b.start, endTime: b.end, locationId: locId(d.locationId) })));
    if (values.length) await tx.insert(schema.staffSchedules).values(values);
    await tx.update(schema.staff).set({ rotationWeeks, rotationAnchor }).where(eq(schema.staff.id, staffId));
  });
  await setFlash("Hours saved");
  revalidatePath(`/app/${slug}/staff/${staffId}/hours`);
}

export async function saveStaffServices(formData: FormData) {
  const slug = String(formData.get("slug"));
  const staffId = String(formData.get("staffId"));
  const ctx = await requireAction(slug, "staff.manage");
  const serviceIds = formData.getAll("serviceIds").map(String);
  try {
    const picks = serviceIds.map((serviceId) => ({ serviceId, price: parsePriceField(formData.get(`price_${serviceId}`)), duration: parseMinutesField(formData.get(`duration_${serviceId}`)) }));
    await withTenant(ctx.business.id, (tx) => applyStaffServices(tx, ctx.business.id, staffId, picks));
  } catch (e) {
    if (e instanceof TermError) {
      await setFlash(e.message, "error");
      return;
    }
    throw e;
  }
  await setFlash("Services and prices saved");
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
    /** In-app path to go to after saving (the team-wide form on Staff hours). */
    returnTo: z.string().optional(),
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
  revalidatePath(`/app/${o.slug}/staff-hours`);
  const span = dates.length > 1 ? ` for ${dates.length} days` : "";
  const message = o.kind === "off" ? `Time off added${span}` : `Custom hours added${span}`;
  if (o.returnTo && o.returnTo.startsWith(`/app/${o.slug}/`)) {
    await setFlash(message);
    redirect(o.returnTo);
  }
  return message;
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
  const chosen = roles.find((r) => r.key === parsed.data.role);
  if (!chosen || parsed.data.role === "owner") return { error: "Pick a role from the list." };
  try {
    await assertMayAssignRole(ctx.business.id, chosen.key, roleActor(ctx));
  } catch (e) {
    if (e instanceof RoleError) return { error: e.message };
    throw e;
  }
  // Someone whose role only sees their own calendar is a bookable stylist; desk and management roles are not (editable per person under Staff).
  const worksCalendar = worksOwnCalendar(new Set(chosen.permissions.filter(isAction)));
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
            bookableOnline: worksCalendar,
            takesAppointments: worksCalendar,
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
    effectiveFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a date"),
    note: f.optional(200),
  }),
  async (d) => {
    const ctx = await requireAction(d.slug, "payroll.view");
    if (d.payType === "hourly" && !d.hourlyRate) throw new FormError("Enter an hourly rate", "hourlyRate");
    if (d.payType === "salary" && !d.salaryPerPeriod) throw new FormError("Enter the salary per period", "salaryPerPeriod");
    const today = instantToISODate(new Date(), ctx.business.timezone);
    // Position is descriptive, not pay: it changes on the record right away.
    await withTenant(ctx.business.id, (tx) => tx.update(schema.staff).set({ position: d.position }).where(eq(schema.staff.id, d.staffId)));
    await recordPayChangeOrFieldError({
      businessId: ctx.business.id,
      timezone: ctx.business.timezone,
      staffId: d.staffId,
      effectiveFrom: d.effectiveFrom,
      note: d.note,
      actorUserId: ctx.user.id,
      rates: {
        payType: d.payType,
        mainCommissionBps: d.mainCommissionPct,
        productCommissionBps: d.productCommissionPct,
        ccTipFeeBps: d.ccTipFeePct,
        hourlyRateCents: d.hourlyRate ?? 0,
        salaryPerPeriodCents: d.salaryPerPeriod ?? 0,
        overtimeOverride: d.overtimeOverride === "default" ? null : d.overtimeOverride === "yes",
        taxDeductionCents: d.taxDeductionAmount,
        taxDeductionBps: d.taxDeductionPct,
      },
    });
    revalidatePath(`/app/${d.slug}/staff/${d.staffId}/pay`);
    return d.effectiveFrom > today ? `Saved. These settings start on ${d.effectiveFrom}; until then the current ones apply.` : "Pay settings saved";
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

/** Move a team member up or down the list clients see on the booking page (active people only; the rest keep their place). */
export async function moveStaffAction(formData: FormData) {
  const d = z.object({ slug: z.string(), staffId: z.string().min(1), dir: z.enum(["up", "down"]) }).parse(Object.fromEntries(formData));
  const ctx = await requireAction(d.slug, "staff.manage");
  await withTenant(ctx.business.id, async (tx) => {
    const people = await tx.select({ id: schema.staff.id }).from(schema.staff).where(eq(schema.staff.active, true)).orderBy(asc(schema.staff.sortOrder), asc(schema.staff.displayName), asc(schema.staff.id));
    const ids = people.map((p) => p.id);
    const at = ids.indexOf(d.staffId);
    const to = d.dir === "up" ? at - 1 : at + 1;
    if (at < 0 || to < 0 || to >= ids.length) return;
    [ids[at], ids[to]] = [ids[to]!, ids[at]!];
    // Number everyone, so people who all had the same value get a real order.
    for (const [i, id] of ids.entries()) await tx.update(schema.staff).set({ sortOrder: i * 10 }).where(eq(schema.staff.id, id));
  });
  revalidatePath(`/app/${d.slug}/staff`);
  revalidatePath(`/book/${d.slug}`);
}

/** A pay change that would rewrite a finalized period is shown on the date field. */
async function recordPayChangeOrFieldError(input: Parameters<typeof recordPayChange>[0]) {
  try {
    await recordPayChange(input);
  } catch (e) {
    if (e instanceof PayrollLockedError) throw new FormError(e.message, "effectiveFrom");
    throw e;
  }
}
