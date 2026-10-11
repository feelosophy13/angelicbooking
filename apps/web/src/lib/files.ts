/**
 * Small-file storage in Postgres (logos, cover photos, product, service and category images).
 * Files are served from /api/files/<id> with long cache headers; ids are
 * unguessable UUIDs. Keeps the app single-dependency until object storage
 * is worth adding.
 */
import { eq } from "drizzle-orm";
import { db, schema } from "@angelic/db";
import { appUrl } from "./stripe";

export const MAX_FILE_BYTES = 2 * 1024 * 1024;
const ALLOWED = new Set(["image/png", "image/jpeg", "image/webp", "image/gif", "image/svg+xml"]);

export class FileError extends Error {}

export async function storeImage(businessId: string, kind: "logo" | "cover" | "product" | "service" | "category" | "staff", file: File): Promise<{ id: string; url: string }> {
  if (!file || file.size === 0) throw new FileError("Choose an image file.");
  if (!ALLOWED.has(file.type)) throw new FileError("Use a PNG, JPEG, WebP, GIF or SVG image.");
  if (file.size > MAX_FILE_BYTES) throw new FileError("Images must be 2 MB or smaller.");
  const data = Buffer.from(await file.arrayBuffer());
  const [row] = await db.insert(schema.files).values({ businessId, kind, contentType: file.type, size: data.length, data }).returning({ id: schema.files.id });
  return { id: row!.id, url: appUrl(`/api/files/${row!.id}`) };
}

export async function deleteFileByUrl(url: string | null | undefined) {
  const id = fileIdFromUrl(url);
  if (id) await db.delete(schema.files).where(eq(schema.files.id, id));
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
  const data = Buffer.from(await file.arrayBuffer());
  const [row] = await db.insert(schema.files).values({ businessId, kind: "form", contentType: file.type, size: data.length, data }).returning({ id: schema.files.id });
  return row!.id;
}

/** A drawn signature posted by the pad as a PNG data URL. */
export async function storeSignaturePng(businessId: string, dataUrl: string): Promise<string> {
  const m = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
  if (!m) throw new FileError("Signature image is not valid.");
  const data = Buffer.from(m[1]!, "base64");
  if (data.length < 200 || data.length > 400 * 1024) throw new FileError("Signature image is not valid.");
  const [row] = await db.insert(schema.files).values({ businessId, kind: "signature", contentType: "image/png", size: data.length, data }).returning({ id: schema.files.id });
  return row!.id;
}

export const fileUrl = (id: string) => appUrl(`/api/files/${id}`);

/**
 * Read an optional `<input type="file" name="image">` from a form and store it.
 * Returns the new URL, or null when nothing was chosen. Throws FileError on bad input.
 */
export async function uploadedImageFrom(businessId: string, kind: "product" | "service" | "category", raw: FormData, field = "image"): Promise<string | null> {
  const file = raw.get(field);
  if (!(file instanceof File) || file.size === 0) return null;
  return (await storeImage(businessId, kind, file)).url;
}
