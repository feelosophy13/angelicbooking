/**
 * Fake before/after photos for demo tenants, made with the app's own upload code so they are resized and stored
 * exactly like real ones. Demo pictures always stay in Postgres: the R2 keys are blanked so nothing reaches the real bucket.
 */
import sharp from "sharp";
import { and, desc, eq } from "drizzle-orm";
import { schema, withTenant } from "@angelic/db";
import { addVisitPhotos, setPairDetails } from "../src/server/visit-photos";

const TAGS = [["balayage", "blonde"], ["color", "brunette"], ["cut", "short"], ["bridal", "updo"], ["highlights"], ["nails", "gel"], ["facial", "glow"], ["brows"], ["lash lift"], ["volume", "lashes"]];

/** The SVG renderer does not read hsl(), so colours are written as hex. */
function hsl(h: number, s: number, l: number) {
  const a = (s / 100) * Math.min(l / 100, 1 - l / 100);
  const f = (n: number) => { const k = (n + h / 30) % 12; const c = l / 100 - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)); return Math.round(255 * c).toString(16).padStart(2, "0"); };
  return `#${f(0)}${f(8)}${f(4)}`;
}

async function picture(hue: number, label: string, after: boolean) {
  const sat = after ? 70 : 25;
  const light = after ? 62 : 55;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="1500"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${hsl(hue, sat, light)}"/><stop offset="1" stop-color="${hsl((hue + 40) % 360, sat, light - 22)}"/></linearGradient></defs><rect width="1200" height="1500" fill="url(#g)"/><circle cx="600" cy="560" r="${after ? 300 : 260}" fill="#ffffff" fill-opacity="${after ? 0.35 : 0.18}"/><text x="600" y="1330" font-family="sans-serif" font-size="120" text-anchor="middle" fill="white">${label}</text></svg>`;
  return sharp(Buffer.from(svg)).jpeg({ quality: 92 }).toBuffer();
}

/** Adds before/after pairs to the demo tenant's most recent completed visits. */
export async function seedDemoPhotos(businessId: string, actorUserId: string, count = 16): Promise<number> {
  process.env.R2_ACCESS_KEY_ID = "";
  process.env.R2_SECRET_ACCESS_KEY = "";
  const recent = await withTenant(businessId, (tx) =>
    tx
      .select({ id: schema.appointments.id, serviceId: schema.appointmentItems.serviceId, staffId: schema.appointmentItems.staffId, startAt: schema.appointmentItems.startAt })
      .from(schema.appointments)
      .innerJoin(schema.appointmentItems, eq(schema.appointmentItems.appointmentId, schema.appointments.id))
      .where(and(eq(schema.appointments.kind, "visit"), eq(schema.appointments.status, "completed")))
      .orderBy(desc(schema.appointmentItems.startAt))
      .limit(600),
  );
  // Spread the pairs across the whole history instead of bunching them on the latest days.
  const step = Math.max(1, Math.floor(recent.length / count));
  const picks = recent.filter((_, i) => i % step === 0);
  let made = 0;
  const seen = new Set<string>();
  for (const a of picks) {
    if (made >= count) break;
    if (!a.serviceId || seen.has(a.id)) continue; // one pair per appointment
    seen.add(a.id);
    const hue = (made * 47) % 360;
    const mk = async (phase: "before" | "after", n: number) => {
      const files: File[] = [];
      for (let k = 0; k < n; k++) files.push(new File([new Uint8Array(await picture(hue + k * 8, `${phase} ${k + 1}`, phase === "after"))], `${phase}.jpg`, { type: "image/jpeg" }));
      await addVisitPhotos({ businessId, appointmentId: a.id, serviceId: a.serviceId, staffId: a.staffId, phase, files, actorUserId });
    };
    await mk("before", made % 5 === 0 ? 2 : 1);
    if (made % 6 !== 5) await mk("after", made % 4 === 0 ? 2 : 1); // a few visits only have the before so far
    await setPairDetails({ businessId, appointmentId: a.id, serviceId: a.serviceId, staffId: a.staffId, tags: TAGS[made % TAGS.length]!, shareOk: made % 3 === 0, actorUserId });
    // Real photos are taken during the visit; give the demo ones the visit's date and time.
    await withTenant(businessId, (tx) => tx.update(schema.visitPhotos).set({ takenAt: a.startAt }).where(eq(schema.visitPhotos.appointmentId, a.id)));
    made++;
  }
  return made;
}
