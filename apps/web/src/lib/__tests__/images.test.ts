import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { ImageError, MAX_SVG_BYTES, optimizeUpload, prepareImage } from "../images";

const raster = (w: number, h: number) => sharp({ create: { width: w, height: h, channels: 3, background: "#cc3355" } });

describe("prepareImage", () => {
  it("shrinks a large photo to web size as WebP", async () => {
    const big = await raster(3000, 2000).jpeg().toBuffer();
    const out = await prepareImage("service", big, "image/jpeg");
    const meta = await sharp(out.data).metadata();
    expect(out.contentType).toBe("image/webp");
    expect(meta.format).toBe("webp");
    expect(Math.max(meta.width!, meta.height!)).toBe(1600);
    expect(out.data.length).toBeLessThan(big.length);
  });
  it("allows a wider cover and a smaller logo", async () => {
    const big = await raster(3000, 1000).png().toBuffer();
    expect((await sharp((await prepareImage("cover", big, "image/png")).data).metadata()).width).toBe(2000);
    expect((await sharp((await prepareImage("logo", big, "image/png")).data).metadata()).width).toBe(800);
  });
  it("never enlarges a small picture", async () => {
    const small = await raster(300, 200).png().toBuffer();
    const meta = await sharp((await prepareImage("service", small, "image/png")).data).metadata();
    expect([meta.width, meta.height]).toEqual([300, 200]);
  });
  it("drops EXIF data such as the camera's location", async () => {
    const withExif = await raster(400, 300).withExif({ IFD0: { Copyright: "someone" } }).jpeg().toBuffer();
    expect((await sharp(withExif).metadata()).exif).toBeTruthy();
    const out = await prepareImage("service", withExif, "image/jpeg");
    expect((await sharp(out.data).metadata()).exif).toBeUndefined();
  });
  it("turns a GIF into WebP, keeping it animated", async () => {
    const frames = Buffer.concat([0, 1].map((i) => Buffer.alloc(40 * 40 * 3, i ? 255 : 0)));
    const gif = await sharp(frames, { raw: { width: 40, height: 40 * 2, channels: 3, pageHeight: 40 } }).gif().toBuffer();
    const out = await prepareImage("service", gif, "image/gif");
    const meta = await sharp(out.data, { animated: true }).metadata();
    expect(out.contentType).toBe("image/webp");
    expect(meta.pages).toBe(2);
  });
  it("stores SVG, PDF and HEIC as sent, and caps SVG size", async () => {
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>');
    expect(await optimizeUpload("service", svg, "image/svg+xml")).toMatchObject({ data: svg, ext: "svg", resized: false });
    const pdf = Buffer.from("%PDF-1.4 test");
    expect(await optimizeUpload("form", pdf, "application/pdf")).toMatchObject({ data: pdf, ext: "pdf" });
    expect(await optimizeUpload("form", Buffer.from("heic bytes"), "image/heic")).toMatchObject({ ext: "heic" });
    await expect(optimizeUpload("service", Buffer.alloc(MAX_SVG_BYTES + 1, 32), "image/svg+xml")).rejects.toThrow(ImageError);
  });
  it("shrinks client form photos like any other picture", async () => {
    const big = await raster(4000, 3000).jpeg().toBuffer();
    const out = await optimizeUpload("form", big, "image/jpeg");
    expect(out.contentType).toBe("image/webp");
    expect((await sharp(out.data).metadata()).width).toBe(2000);
  });
  it("recompresses a drawn signature as a small PNG", async () => {
    const raw = Buffer.alloc(600 * 200 * 4, 0);
    for (let i = 0; i < 600; i++) { const o = (100 * 600 + i) * 4; raw[o] = 20; raw[o + 1] = 20; raw[o + 2] = 20; raw[o + 3] = 255; }
    const png = await sharp(raw, { raw: { width: 600, height: 200, channels: 4 } }).png({ compressionLevel: 0 }).toBuffer();
    const out = await optimizeUpload("signature", png, "image/png");
    expect(out.contentType).toBe("image/png");
    expect(out.data.length).toBeLessThan(png.length);
    expect((await sharp(out.data).metadata()).width).toBe(600);
  });
  it("rejects bytes that are not a picture", async () => {
    await expect(prepareImage("service", Buffer.from("not an image at all"), "image/png")).rejects.toThrow(ImageError);
  });
});
