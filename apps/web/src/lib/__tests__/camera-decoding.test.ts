import { describe, expect, it } from "vitest";
import { BarcodeFormat, BinaryBitmap, DecodeHintType, HybridBinarizer, MultiFormatReader, RGBLuminanceSource } from "@zxing/library";
import { matchScan } from "../scan";

// An EAN-13 drawn the way a label prints it, to check the reader the camera screen uses (same formats and hints) can read what a shelf holds.
const L = ["0001101", "0011001", "0010011", "0111101", "0100011", "0110001", "0101111", "0111011", "0110111", "0001011"];
const G = ["0100111", "0110011", "0011011", "0100001", "0011101", "0111001", "0000101", "0010001", "0001001", "0010111"];
const R = ["1110010", "1100110", "1101100", "1000010", "1011100", "1001110", "1010000", "1000100", "1001000", "1110100"];
const PARITY = ["LLLLLL", "LLGLGG", "LLGGLG", "LLGGGL", "LGLLGG", "LGGLLG", "LGGGLL", "LGLGLG", "LGLGGL", "LGGLGL"];
const checkDigit = (d12: string) => String((10 - (d12.split("").reduce((s, c, i) => s + Number(c) * (i % 2 ? 3 : 1), 0) % 10)) % 10);

function ean13Bars(code: string): string {
  const d = code.split("").map(Number);
  const par = PARITY[d[0]!]!;
  let bits = "101";
  for (let i = 0; i < 6; i++) bits += (par[i] === "L" ? L : G)[d[i + 1]!];
  bits += "01010";
  for (let i = 0; i < 6; i++) bits += R[d[i + 7]!];
  return bits + "101";
}

function image(bars: string, scale = 4, quiet = 12, height = 60) {
  const modules = quiet * 2 + bars.length;
  const width = modules * scale;
  const px = new Uint8ClampedArray(width * height).fill(255);
  for (let m = 0; m < bars.length; m++) if (bars[m] === "1") for (let y = 0; y < height; y++) for (let x = 0; x < scale; x++) px[y * width + (quiet + m) * scale + x] = 0;
  return { px, width, height };
}

function read(code: string) {
  const { px, width, height } = image(ean13Bars(code));
  const hints = new Map();
  hints.set(DecodeHintType.POSSIBLE_FORMATS, [BarcodeFormat.EAN_13, BarcodeFormat.EAN_8, BarcodeFormat.UPC_A, BarcodeFormat.UPC_E, BarcodeFormat.CODE_128, BarcodeFormat.CODE_39, BarcodeFormat.ITF]);
  hints.set(DecodeHintType.TRY_HARDER, true);
  const reader = new MultiFormatReader();
  reader.setHints(hints);
  return reader.decode(new BinaryBitmap(new HybridBinarizer(new RGBLuminanceSource(px, width, height)))).getText();
}

describe("reading a barcode from an image, as the camera screen does", () => {
  it("reads an EAN-13", () => {
    const code = "590123412345" + checkDigit("590123412345");
    expect(read(code)).toBe(code);
  });
  it("what it reads matches the product by the same rules a hand scanner's text does", () => {
    const code = "401234567890" + checkDigit("401234567890");
    const products = [{ id: "p", label: "Gel", barcode: code, sku: null }];
    expect(matchScan(products, read(code))?.product.id).toBe("p");
  });
  it("a UPC-A label (EAN-13 with a leading 0) still matches the 12-digit code on the product", () => {
    const upc = "036000291452";
    const products = [{ id: "u", label: "UPC item", barcode: upc, sku: null }];
    const ean = "0" + upc;
    // The reader may report it as the 12-digit UPC-A or the 13-digit EAN-13; either way it is the same product.
    expect([upc, ean]).toContain(read(ean));
    expect(matchScan(products, read(ean))?.product.id).toBe("u");
  });
});
