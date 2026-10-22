/**
 * Every upload passes through `optimizeUpload` before it is stored, with no exceptions:
 *   - photos and graphics (JPEG, PNG, WebP, GIF) are resized to web size and re-encoded as WebP (JPEG or PNG for texts and emails), and their
 *     EXIF data (camera, GPS location) is dropped; animated GIFs become animated WebP,
 *   - drawn signatures are recompressed as a small palette PNG,
 *   - only types that cannot be shrunk here are stored as sent: SVG (already text, capped in size), PDF, and
 *     HEIC (the image library cannot decode it; phones normally hand the browser a JPEG anyway).
 * New upload code must call this (through `lib/files.ts`), never write bytes to storage directly.
 */
import sharp from "sharp";

export class ImageError extends Error {}

/** Longest side, in pixels, by what the picture is for. */
export const MAX_SIDE: Record<string, number> = { cover: 2000, logo: 800, staff: 800, client: 800, form: 2000, visit: 2000, thumb: 640, mms: 1200, email: 1200 };
export const DEFAULT_MAX_SIDE = 1600;
export const MAX_SVG_BYTES = 512 * 1024;

export type PreparedImage = { data: Buffer; contentType: string; ext: string; resized: boolean };

const EXT: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/gif": "gif", "image/svg+xml": "svg", "image/heic": "heic", "image/heif": "heif", "application/pdf": "pdf" };
/**
 * Types stored exactly as sent because they cannot be shrunk here. SVG is not one of them: it can carry script, and pictures are served
 * from our own image domain, so it is drawn into an ordinary image instead (which also makes it safe to show anywhere).
 */
const AS_SENT = new Set(["application/pdf", "image/heic", "image/heif"]);
const UNREADABLE = "That file isn't a picture we can read. Try a PNG, JPEG or WebP.";

/** Resize and re-encode a photo or graphic as WebP. Animated GIFs stay animated. */
export async function prepareImage(kind: string, input: Buffer, contentType: string): Promise<PreparedImage> {
  try {
    const max = MAX_SIDE[kind] ?? DEFAULT_MAX_SIDE;
    const svg = contentType === "image/svg+xml";
    // An SVG is drawn at high density so a small logo stays sharp once sized down to the limit.
    const pipeline = sharp(input, { limitInputPixels: 60_000_000, animated: contentType === "image/gif", ...(svg ? { density: 300 } : {}) })
      .rotate() // honour the camera's orientation before the metadata is dropped
      .resize({ width: max, height: max, fit: "inside", withoutEnlargement: true });
    // A picture texted to a client goes as JPEG: every phone and carrier shows it, which is not true of WebP over MMS.
    if (kind === "mms") return { data: await pipeline.flatten({ background: "#fff" }).jpeg({ quality: 82 }).toBuffer(), contentType: "image/jpeg", ext: "jpg", resized: true };
    // A picture in an email design: Outlook for Windows can't show WebP, so graphics stay PNG (transparency kept), animations GIF and photos become JPEG.
    if (kind === "email") {
      if (contentType === "image/gif") return { data: await pipeline.gif().toBuffer(), contentType: "image/gif", ext: "gif", resized: true };
      if (contentType === "image/png" || svg) return { data: await pipeline.png({ compressionLevel: 9 }).toBuffer(), contentType: "image/png", ext: "png", resized: true };
      return { data: await pipeline.flatten({ background: "#fff" }).jpeg({ quality: 85 }).toBuffer(), contentType: "image/jpeg", ext: "jpg", resized: true };
    }
    // Screenshots, logos and graphics (PNG) stay crisp as lossless WebP; photos and animations use lossy.
    const data = await (contentType === "image/png" || svg ? pipeline.webp({ lossless: true }) : pipeline.webp({ quality: 82 })).toBuffer();
    return { data, contentType: "image/webp", ext: "webp", resized: true };
  } catch {
    throw new ImageError(UNREADABLE);
  }
}

/** A signature drawn on the pad: a few colours of ink on a transparent background, so a palette PNG is tiny. */
export async function prepareSignature(input: Buffer): Promise<PreparedImage> {
  try {
    const data = await sharp(input, { limitInputPixels: 10_000_000 }).png({ palette: true, compressionLevel: 9, effort: 10 }).toBuffer();
    return { data: data.length < input.length ? data : input, contentType: "image/png", ext: "png", resized: data.length < input.length };
  } catch {
    throw new ImageError("Signature image is not valid.");
  }
}

/** The one door every uploaded picture or attachment goes through before storage. */
export async function optimizeUpload(kind: string, input: Buffer, contentType: string): Promise<PreparedImage> {
  if (contentType === "image/svg+xml" && input.length > MAX_SVG_BYTES) throw new ImageError("SVG images must be 512 KB or smaller. Use a PNG or JPEG instead.");
  if (AS_SENT.has(contentType)) return { data: input, contentType, ext: EXT[contentType]!, resized: false };
  if (kind === "signature") return prepareSignature(input);
  return prepareImage(kind, input, contentType);
}
