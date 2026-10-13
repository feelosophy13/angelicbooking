/**
 * Pictures are resized and re-encoded on the way in: a phone photo of several megabytes becomes a
 * web-sized WebP of a few hundred kilobytes, and its EXIF data (camera, GPS location) is dropped.
 * SVG and animated GIF pass through untouched.
 */
import sharp from "sharp";

export class ImageError extends Error {}

/** Longest side, in pixels, by what the picture is for. */
export const MAX_SIDE: Record<string, number> = { cover: 2000, logo: 800, staff: 800 };
export const DEFAULT_MAX_SIDE = 1600;

export type PreparedImage = { data: Buffer; contentType: string; ext: string; resized: boolean };

const EXT: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/gif": "gif", "image/svg+xml": "svg" };

export async function prepareImage(kind: string, input: Buffer, contentType: string): Promise<PreparedImage> {
  // Vector and animated pictures are stored as sent.
  if (contentType === "image/svg+xml" || contentType === "image/gif") return { data: input, contentType, ext: EXT[contentType]!, resized: false };
  try {
    const max = MAX_SIDE[kind] ?? DEFAULT_MAX_SIDE;
    const pipeline = sharp(input, { limitInputPixels: 60_000_000 })
      .rotate() // honour the camera's orientation before the metadata is dropped
      .resize({ width: max, height: max, fit: "inside", withoutEnlargement: true });
    // Screenshots, logos and graphics (PNG) stay crisp as lossless WebP; photos use lossy.
    const data = await (contentType === "image/png" ? pipeline.webp({ lossless: true }) : pipeline.webp({ quality: 82 })).toBuffer();
    return { data, contentType: "image/webp", ext: "webp", resized: true };
  } catch {
    throw new ImageError("That file isn't a picture we can read. Try a PNG, JPEG or WebP.");
  }
}
