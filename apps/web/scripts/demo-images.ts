/**
 * Give the demo tenants' products and packages pictures (idempotent: only rows without one).
 * Usage (from apps/web): ../../packages/db/node_modules/.bin/tsx --env-file=../../.env scripts/demo-images.ts
 */
import { eq, isNull, inArray } from "drizzle-orm";
import { db, schema, withTenant } from "@angelic/db";
import { appUrl } from "../src/lib/stripe";
import { PACKAGE_BLURBS, PACKAGE_PHOTOS, productArt } from "./demo-art";

const IMG = "https://angelicbeauty.s3.us-east-2.amazonaws.com/images/";

async function store(businessId: string, kind: "product" | "package", contentType: string, data: Buffer) {
  const [row] = await withTenant(businessId, (tx) => tx.insert(schema.files).values({ businessId, kind, contentType, size: data.length, data }).returning({ id: schema.files.id }));
  return appUrl(`/api/files/${row!.id}`);
}

async function main() {
  const demos = await db.select({ id: schema.businesses.id, slug: schema.businesses.slug }).from(schema.businesses).where(inArray(schema.businesses.slug, ["demo-salon", "demo-twosites"]));
  for (const b of demos) {
    // Tenant tables sit behind row-level security, so read and write them inside the tenant context.
    const { products, packs } = await withTenant(b.id, async (tx) => ({
      products: await tx.select({ id: schema.products.id, name: schema.products.name }).from(schema.products).where(isNull(schema.products.imageUrl)).orderBy(schema.products.name),
      packs: await tx.select({ id: schema.packages.id, name: schema.packages.name }).from(schema.packages).where(isNull(schema.packages.imageUrl)),
    }));
    for (const [i, p] of products.entries()) {
      const url = await store(b.id, "product", "image/svg+xml", Buffer.from(productArt(p.name, i), "utf8"));
      await withTenant(b.id, (tx) => tx.update(schema.products).set({ imageUrl: url }).where(eq(schema.products.id, p.id)));
    }
    for (const p of packs) {
      const path = PACKAGE_PHOTOS[p.name];
      let url: string | null = null;
      if (path) {
        const r = await fetch(IMG + path).catch(() => null);
        if (r?.ok) url = await store(b.id, "package", r.headers.get("content-type")?.split(";")[0] || "image/jpeg", Buffer.from(await r.arrayBuffer()));
      }
      await withTenant(b.id, (tx) => tx.update(schema.packages).set({ ...(url ? { imageUrl: url } : {}), description: PACKAGE_BLURBS[p.name] ?? null }).where(eq(schema.packages.id, p.id)));
    }
    console.log(`${b.slug}: ${products.length} product pictures, ${packs.length} package pictures`);
  }
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
