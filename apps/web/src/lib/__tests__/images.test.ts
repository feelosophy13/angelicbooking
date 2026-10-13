import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { ImageError, prepareImage } from "../images";

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
  it("passes SVG and GIF through untouched", async () => {
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>');
    expect(await prepareImage("service", svg, "image/svg+xml")).toMatchObject({ data: svg, ext: "svg", resized: false });
    const gif = Buffer.from("GIF89a....");
    expect(await prepareImage("service", gif, "image/gif")).toMatchObject({ data: gif, ext: "gif", resized: false });
  });
  it("rejects bytes that are not a picture", async () => {
    await expect(prepareImage("service", Buffer.from("not an image at all"), "image/png")).rejects.toThrow(ImageError);
  });
});
