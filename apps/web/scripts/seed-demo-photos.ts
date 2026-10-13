/**
 * Adds fake before/after photos to a demo tenant so the Gallery can be walked through. Uses the app's own code,
 * so photos are resized and stored exactly like real ones. Run with R2 turned off to keep demo pictures out of
 * the real bucket:
 *   R2_ACCESS_KEY_ID= ../../packages/db/node_modules/.bin/tsx --env-file=../../.env scripts/seed-demo-photos.ts [slug]
 * Never run it against a real business.
 */
import sharp from "sharp";
import { and, desc, eq, inArray } from "drizzle-orm";
import { db, schema, withTenant } from "@angelic/db";
import { addVisitPhotos, setPairDetails } from "../src/server/visit-photos";

const slug = process.argv[2] ?? "demo-salon";
const TAGS = [["balayage", "blonde"], ["color", "brunette"], ["cut", "short"], ["bridal", "updo"], ["highlights"], ["nails", "gel"], ["facial", "glow"], ["brows"]];

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

async function main() {
  const biz = await db.query.businesses.findFirst({ where: eq(schema.businesses.slug, slug) });
  if (!biz || !/^demo-/.test(biz.slug)) throw new Error("Only demo-* businesses can be seeded with fake photos.");
  const appts = await withTenant(biz.id, (tx) =>
    tx.select({ id: schema.appointments.id }).from(schema.appointments).where(and(eq(schema.appointments.kind, "visit"), eq(schema.appointments.status, "completed"))).orderBy(desc(schema.appointments.createdAt)).limit(14),
  );
  let n = 0;
  for (const [i, a] of appts.entries()) {
    const items = await withTenant(biz.id, (tx) => tx.select().from(schema.appointmentItems).where(eq(schema.appointmentItems.appointmentId, a.id)));
    const item = items[0];
    if (!item) continue;
    const hue = (i * 47) % 360;
    const mk = async (phase: "before" | "after", count: number) => {
      const files: File[] = [];
      for (let k = 0; k < count; k++) files.push(new File([new Uint8Array(await picture(hue + k * 8, `${phase} ${k + 1}`, phase === "after"))], `${phase}.jpg`, { type: "image/jpeg" }));
      await addVisitPhotos({ businessId: biz.id, appointmentId: a.id, serviceId: item.serviceId, staffId: item.staffId, phase, files, actorUserId: "demo-seed" });
    };
    await mk("before", i % 5 === 0 ? 2 : 1);
    if (i % 6 !== 5) await mk("after", i % 4 === 0 ? 2 : 1); // a few visits only have the before so far
    await setPairDetails({ businessId: biz.id, appointmentId: a.id, serviceId: item.serviceId, staffId: item.staffId, tags: TAGS[i % TAGS.length]!, shareOk: i % 3 === 0, actorUserId: "demo-seed" });
    n++;
  }
  console.log(`seeded ${n} visits in ${slug}`);
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
