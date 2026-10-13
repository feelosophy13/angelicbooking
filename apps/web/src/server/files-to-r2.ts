/**
 * Move files already stored in Postgres to Cloudflare R2, a batch at a time. Safe to run repeatedly:
 * only rows still in the database are touched, each one is copied before its bytes are dropped, and a
 * failure leaves that row where it was. Public pictures are resized on the way (like new uploads) and
 * the addresses saved on services, categories, products, packages, staff and the business are
 * rewritten to the CDN address so visitors skip the redirect through the app.
 */
import { and, asc, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { db, schema, withTenant } from "@angelic/db";
import { prepareImage } from "@/lib/images";
import { PRIVATE_KINDS, visibilityOf } from "@/lib/files";
import { publicObjectUrl, putObject, r2Config } from "@/lib/object-storage";
import { randomUUID } from "node:crypto";

/** File kinds that are pictures or client files. Anything else in `files` (staged imports) stays in Postgres. */
const MOVABLE = ["logo", "cover", "product", "package", "service", "category", "staff", "form", "signature"];
const IMMUTABLE = "public, max-age=31536000, immutable";
const EXT: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/gif": "gif", "image/svg+xml": "svg", "image/heic": "heic", "application/pdf": "pdf" };

export async function filesLeftInDatabase() {
  const [r] = await db
    .select({ n: sql<number>`count(*)`, bytes: sql<number>`coalesce(sum(${schema.files.size}), 0)` })
    .from(schema.files)
    .where(and(eq(schema.files.storage, "db"), isNotNull(schema.files.data), inArray(schema.files.kind, MOVABLE)));
  return { files: Number(r?.n ?? 0), bytes: Number(r?.bytes ?? 0) };
}

export async function migrateFilesToR2(limit = 20, only?: string[]): Promise<{ moved: number; failed: number; bytesBefore: number; bytesAfter: number; left: { files: number; bytes: number } }> {
  const cfg = r2Config();
  if (!cfg) throw new Error("R2 is not configured (set the R2_* variables).");
  const rows = await db
    .select()
    .from(schema.files)
    .where(and(eq(schema.files.storage, "db"), isNotNull(schema.files.data), inArray(schema.files.kind, MOVABLE), ...(only ? [inArray(schema.files.id, only)] : [])))
    .orderBy(asc(schema.files.createdAt))
    .limit(limit);
  let moved = 0;
  let failed = 0;
  let bytesBefore = 0;
  let bytesAfter = 0;
  const rewrites: { businessId: string; id: string; url: string }[] = [];
  for (const row of rows) {
    try {
      const visibility = visibilityOf(row.kind);
      let data: Buffer = Buffer.from(row.data!);
      let contentType = row.contentType;
      let ext = EXT[contentType] ?? "bin";
      if (visibility === "public") {
        const p = await prepareImage(row.kind, data, contentType);
        data = p.data;
        contentType = p.contentType;
        ext = p.ext;
      }
      const key = `${row.businessId}/${row.kind}/${randomUUID()}.${ext}`;
      await putObject(cfg, visibility, key, data, contentType, visibility === "public" ? IMMUTABLE : undefined);
      await db.update(schema.files).set({ storage: "r2", storageKey: key, contentType, size: data.length, data: null }).where(and(eq(schema.files.id, row.id), eq(schema.files.storage, "db")));
      bytesBefore += row.size;
      bytesAfter += data.length;
      moved++;
      if (!PRIVATE_KINDS.has(row.kind)) rewrites.push({ businessId: row.businessId, id: row.id, url: publicObjectUrl(cfg, key) });
    } catch (e) {
      failed++;
      console.error("[files-to-r2] could not move", row.id, (e as Error).message);
    }
  }
  // Point saved addresses at the CDN. Old /api/files addresses keep working through the redirect either way.
  for (const r of rewrites) {
    const like = `%/api/files/${r.id}`;
    await withTenant(r.businessId, async (tx) => {
      await tx.update(schema.services).set({ imageUrl: r.url }).where(sql`${schema.services.imageUrl} like ${like}`);
      await tx.update(schema.serviceCategories).set({ imageUrl: r.url }).where(sql`${schema.serviceCategories.imageUrl} like ${like}`);
      await tx.update(schema.products).set({ imageUrl: r.url }).where(sql`${schema.products.imageUrl} like ${like}`);
      await tx.update(schema.packages).set({ imageUrl: r.url }).where(sql`${schema.packages.imageUrl} like ${like}`);
      await tx.update(schema.staff).set({ photoUrl: r.url }).where(sql`${schema.staff.photoUrl} like ${like}`);
    });
    await db.update(schema.businesses).set({ logoUrl: r.url }).where(and(eq(schema.businesses.id, r.businessId), sql`${schema.businesses.logoUrl} like ${like}`));
    await db.update(schema.businesses).set({ coverUrl: r.url }).where(and(eq(schema.businesses.id, r.businessId), sql`${schema.businesses.coverUrl} like ${like}`));
  }
  return { moved, failed, bytesBefore, bytesAfter, left: await filesLeftInDatabase() };
}
