/**
 * Small-file storage in Postgres (logos, cover photos, product images).
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

export async function storeImage(businessId: string, kind: "logo" | "cover" | "product", file: File): Promise<{ id: string; url: string }> {
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
