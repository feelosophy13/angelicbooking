import { describe, expect, it } from "vitest";
import { bookingPhotosFrom, clientPhotosFact, droppedParam, MAX_BOOKING_PHOTOS, parseDropped, PHOTOS_FIELD } from "../booking-photos";
import { FileError, storeBookingPhoto } from "../files";

const png = (name = "a.png", bytes = 10) => new File([new Uint8Array(bytes)], name, { type: "image/png" });

describe("bookingPhotosFrom", () => {
  it("reads the attached pictures in order, skips empty entries and caps the count", () => {
    const fd = new FormData();
    fd.append("notes", "hi");
    for (let i = 0; i < MAX_BOOKING_PHOTOS + 2; i++) fd.append(PHOTOS_FIELD, png(`p${i}.png`));
    fd.append(PHOTOS_FIELD, new File([], "empty.png", { type: "image/png" }));
    const files = bookingPhotosFrom(fd);
    expect(files).toHaveLength(MAX_BOOKING_PHOTOS);
    expect(files.map((f) => f.name)).toEqual(["p0.png", "p1.png", "p2.png", "p3.png", "p4.png"]);
  });
  it("copes with no form at all", () => {
    expect(bookingPhotosFrom(null)).toEqual([]);
    expect(bookingPhotosFrom(new FormData())).toEqual([]);
  });
});

describe("dropped photos travel to the confirmation page by name", () => {
  it("round-trips names and strips anything odd", () => {
    const param = droppedParam([{ name: "IMG_4021.HEIC", reason: "x" }, { name: "weird/<name>?.png", reason: "y" }]);
    expect(param).toBe("IMG_4021.HEIC|weirdname.png");
    expect(parseDropped(param!)).toEqual(["IMG_4021.HEIC", "weirdname.png"]);
    expect(droppedParam([])).toBeNull();
    expect(parseDropped(undefined)).toEqual([]);
    expect(parseDropped(["a"] as unknown as string)).toEqual([]);
  });
  it("never lists more than the cap and keeps names short", () => {
    expect(parseDropped(Array.from({ length: 9 }, (_, i) => `f${i}.jpg`).join("|"))).toHaveLength(MAX_BOOKING_PHOTOS);
    expect(parseDropped("x".repeat(100) + ".jpg")[0]!.length).toBeLessThanOrEqual(40);
  });
});

describe("clientPhotosFact", () => {
  it("counts in words for the hover card", () => {
    expect(clientPhotosFact(1)).toBe("1 photo from client");
    expect(clientPhotosFact(3)).toBe("3 photos from client");
    expect(clientPhotosFact(0)).toBeNull();
    expect(clientPhotosFact(null)).toBeNull();
  });
});

describe("storeBookingPhoto refuses what it cannot keep resized", () => {
  it("rejects a file that is not a picture, an oversized one and an unreadable HEIC, each with a message for the client", async () => {
    await expect(storeBookingPhoto("b1", new File([new Uint8Array(10)], "notes.pdf", { type: "application/pdf" }))).rejects.toBeInstanceOf(FileError);
    await expect(storeBookingPhoto("b1", new File([new Uint8Array(11 * 1024 * 1024)], "big.jpg", { type: "image/jpeg" }))).rejects.toThrow(/10 MB/);
    // A HEIC the phone did not convert: the image library cannot read it, so it is refused rather than stored raw.
    await expect(storeBookingPhoto("b1", new File([new Uint8Array(2048)], "IMG_1.HEIC", { type: "" }))).rejects.toBeInstanceOf(FileError);
    await expect(storeBookingPhoto("b1", new File([new Uint8Array(2048)], "IMG_2.heic", { type: "image/heic" }))).rejects.toThrow(/isn't a picture we can read/);
  });
});
