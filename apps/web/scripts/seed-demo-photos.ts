/**
 * Adds fake before/after photos to a demo tenant that already exists (seed-demo.ts does this itself when it builds one).
 *   ../../packages/db/node_modules/.bin/tsx --env-file=../../.env scripts/seed-demo-photos.ts [slug]
 * Never run it against a real business: only demo-* tenants are accepted.
 */
import { eq } from "drizzle-orm";
import { db, schema } from "@angelic/db";
import { seedDemoPhotos } from "./demo-photos";

async function main() {
  const slug = process.argv[2] ?? "demo-salon";
  const biz = await db.query.businesses.findFirst({ where: eq(schema.businesses.slug, slug) });
  if (!biz || !/^demo-/.test(biz.slug)) throw new Error("Only demo-* businesses can be seeded with fake photos.");
  console.log(`seeded photos on ${await seedDemoPhotos(biz.id, "demo-seed")} visits in ${slug}`);
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
