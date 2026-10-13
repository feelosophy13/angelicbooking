/**
 * Uploaded files. With Cloudflare R2 configured (see lib/object-storage.ts) pictures go to a public
 * bucket and are served from its CDN address, while client form photos and signatures go to a private
 * bucket and are read back through /api/files/<id> after a permission check. Without R2 the bytes stay
 * in Postgres and every file is served from /api/files/<id>. Pictures are resized and re-encoded on the
 * way in (lib/images.ts). Ids are unguessable UUIDs.
 */
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db, schema } from "@angelic/db";
import { appUrl } from "./stripe";
import { optimizeUpload, ImageError } from "./images";
import { deleteObject, keyFromPublicUrl, publicObjectUrl, putObject, r2Config, type Visibility } from "./object-storage";

/** What a client may upload, before resizing. */
export const MAX_FILE_BYTES = 8 * 1024 * 1024;
const ALLOWED = new Set(["image/png", "image/jpeg", "image/webp", "image/gif", "image/svg+xml"]);
const IMMUTABLE = "public, max-age=31536000, immutable";

export class FileError extends Error {}

/** Kinds that only a signed-in member or the client who owns them may read. */
export const PRIVATE_KINDS = new Set(["form", "signature"]);
export const visibilityOf = (kind: string): Visibility => (PRIVATE_KINDS.has(kind) ? "private" : "public");

/** Store bytes in R2 when configured (else Postgres) and return the file id and the address to use. */
async function saveFile(businessId: string, kind: string, p: { data: Buffer; contentType: string; ext: string }): Promise<{ id: string; url: string }> {
  const cfg = r2Config();
  const visibility = visibilityOf(kind);
  if (cfg) {
    const key = `${businessId}/${kind}/${randomUUID()}.${p.ext}`;
    await putObject(cfg, visibility, key, p.data, p.contentType, visibility === "public" ? IMMUTABLE : undefined);
    try {
      const [row] = await db.insert(schema.files).values({ businessId, kind, contentType: p.contentType, size: p.data.length, storage: "r2", storageKey: key }).returning({ id: schema.files.id });
      return { id: row!.id, url: visibility === "public" ? publicObjectUrl(cfg, key) : appUrl(`/api/files/${row!.id}`) };
    } catch (e) {
      await deleteObject(cfg, visibility, key).catch(() => undefined); // do not leave an orphan behind
      throw e;
    }
  }
  const [row] = await db.insert(schema.files).values({ businessId, kind, contentType: p.contentType, size: p.data.length, data: p.data }).returning({ id: schema.files.id });
  return { id: row!.id, url: appUrl(`/api/files/${row!.id}`) };
}

export async function storeImage(businessId: string, kind: "logo" | "cover" | "product" | "package" | "service" | "category" | "staff", file: File): Promise<{ id: string; url: string }> {
  if (!file || file.size === 0) throw new FileError("Choose an image file.");
  if (!ALLOWED.has(file.type)) throw new FileError("Use a PNG, JPEG, WebP, GIF or SVG image.");
  if (file.size > MAX_FILE_BYTES) throw new FileError("Images must be 8 MB or smaller.");
  try {
    const prepared = await optimizeUpload(kind, Buffer.from(await file.arrayBuffer()), file.type);
    return await saveFile(businessId, kind, prepared);
  } catch (e) {
    if (e instanceof ImageError) throw new FileError(e.message);
    throw e;
  }
}

/** Delete a stored picture given the address kept on the record (an /api/files address or an R2 CDN address). */
export async function deleteFileByUrl(url: string | null | undefined) {
  const cfg = r2Config();
  const id = fileIdFromUrl(url);
  const key = id ? null : cfg ? keyFromPublicUrl(cfg, url) : null;
  if (!id && !key) return;
  const row = await db.query.files.findFirst({ where: id ? eq(schema.files.id, id) : eq(schema.files.storageKey, key!), columns: { id: true, kind: true, storage: true, storageKey: true } });
  if (!row) return;
  if (row.storage === "r2" && row.storageKey && cfg) await deleteObject(cfg, visibilityOf(row.kind), row.storageKey).catch((e) => console.error("[files] could not delete object", row.storageKey, (e as Error).message));
  await db.delete(schema.files).where(eq(schema.files.id, row.id));
}

export function fileIdFromUrl(url: string | null | undefined): string | null {
  const m = /\/api\/files\/([0-9a-f-]{36})$/.exec(url ?? "");
  return m?.[1] ?? null;
}

const FORM_ALLOWED = new Set(["image/png", "image/jpeg", "image/webp", "image/heic", "application/pdf"]);
export const MAX_FORM_FILE_BYTES = 5 * 1024 * 1024;

/** A photo or PDF a client attaches to a form answer. */
export async function storeFormFile(businessId: string, file: File): Promise<string> {
  if (!file || file.size === 0) throw new FileError("Choose a file.");
  if (!FORM_ALLOWED.has(file.type)) throw new FileError("Attach a photo (PNG, JPEG, WebP, HEIC) or a PDF.");
  if (file.size > MAX_FORM_FILE_BYTES) throw new FileError("Files must be 5 MB or smaller.");
  try {
    return (await saveFile(businessId, "form", await optimizeUpload("form", Buffer.from(await file.arrayBuffer()), file.type))).id;
  } catch (e) {
    if (e instanceof ImageError) throw new FileError(e.message);
    throw e;
  }
}

/** A drawn signature posted by the pad as a PNG data URL. */
export async function storeSignaturePng(businessId: string, dataUrl: string): Promise<string> {
  const m = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
  if (!m) throw new FileError("Signature image is not valid.");
  const data = Buffer.from(m[1]!, "base64");
  if (data.length < 200 || data.length > 400 * 1024) throw new FileError("Signature image is not valid.");
  try {
    return (await saveFile(businessId, "signature", await optimizeUpload("signature", data, "image/png"))).id;
  } catch (e) {
    if (e instanceof ImageError) throw new FileError(e.message);
    throw e;
  }
}

export const fileUrl = (id: string) => appUrl(`/api/files/${id}`);

/**
 * Read an optional `<input type="file" name="image">` from a form and store it.
 * Returns the new URL, or null when nothing was chosen. Throws FileError on bad input.
 */
export async function uploadedImageFrom(businessId: string, kind: "product" | "package" | "service" | "category", raw: FormData, field = "image"): Promise<string | null> {
  const file = raw.get(field);
  if (!(file instanceof File) || file.size === 0) return null;
  return (await storeImage(businessId, kind, file)).url;
}
