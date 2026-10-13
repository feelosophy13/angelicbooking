import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { deleteObject, getObject, keyFromPublicUrl, publicObjectUrl, putObject, r2Config, type R2Config } from "../object-storage";

// A tiny in-memory stand-in for R2's S3 API: path-style PUT / GET / DELETE.
const store = new Map<string, { body: Buffer; type: string; cache: string | null }>();
let server: http.Server;
let cfg: R2Config;

beforeAll(async () => {
  server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      const key = decodeURIComponent((req.url ?? "").split("?")[0]!.slice(1));
      if (req.method === "PUT") {
        store.set(key, { body: Buffer.concat(chunks), type: String(req.headers["content-type"] ?? ""), cache: (req.headers["cache-control"] as string) ?? null });
        res.writeHead(200, { ETag: '"fake"' }).end();
      } else if (req.method === "GET") {
        const hit = store.get(key);
        if (!hit) res.writeHead(404, { "Content-Type": "application/xml" }).end("<?xml version=\"1.0\"?><Error><Code>NoSuchKey</Code><Message>missing</Message></Error>");
        else res.writeHead(200, { "Content-Type": hit.type, "Content-Length": hit.body.length }).end(hit.body);
      } else if (req.method === "DELETE") {
        store.delete(key);
        res.writeHead(204).end();
      } else res.writeHead(405).end();
    });
  });
  await new Promise<void>((ok) => server.listen(0, "127.0.0.1", ok));
  cfg = r2Config({ R2_ACCOUNT_ID: "acct", R2_ACCESS_KEY_ID: "key", R2_SECRET_ACCESS_KEY: "secret", R2_PUBLIC_BUCKET: "pub", R2_PRIVATE_BUCKET: "priv", R2_PUBLIC_BASE_URL: "https://images.example.com/", R2_ENDPOINT: `http://127.0.0.1:${(server.address() as AddressInfo).port}` })!;
});
afterAll(() => new Promise<void>((ok) => server.close(() => ok())));

describe("r2Config", () => {
  it("is off until every variable is set", () => {
    expect(r2Config({})).toBeNull();
    expect(r2Config({ R2_ACCOUNT_ID: "a", R2_ACCESS_KEY_ID: "k", R2_SECRET_ACCESS_KEY: "s", R2_PUBLIC_BUCKET: "p" })).toBeNull();
  });
  it("defaults the endpoint to the account's R2 address and trims the public URL", () => {
    const c = r2Config({ R2_ACCOUNT_ID: "abc", R2_ACCESS_KEY_ID: "k", R2_SECRET_ACCESS_KEY: "s", R2_PUBLIC_BUCKET: "p", R2_PRIVATE_BUCKET: "q", R2_PUBLIC_BASE_URL: "https://img.example.com//" })!;
    expect(c.endpoint).toBe("https://abc.r2.cloudflarestorage.com");
    expect(c.publicBaseUrl).toBe("https://img.example.com");
  });
});

describe("objects", () => {
  it("stores, reads and deletes in the right bucket", async () => {
    await putObject(cfg, "public", "biz1/service/a.webp", Buffer.from("hello"), "image/webp", "public, max-age=31536000, immutable");
    await putObject(cfg, "private", "biz1/form/b.pdf", Buffer.from("secret"), "application/pdf");
    expect(store.get("pub/biz1/service/a.webp")).toMatchObject({ type: "image/webp", cache: "public, max-age=31536000, immutable" });
    expect(store.has("priv/biz1/form/b.pdf")).toBe(true);
    const got = await getObject(cfg, "public", "biz1/service/a.webp");
    expect(got?.body.toString()).toBe("hello");
    expect(got?.contentType).toBe("image/webp");
    await deleteObject(cfg, "public", "biz1/service/a.webp");
    expect(await getObject(cfg, "public", "biz1/service/a.webp")).toBeNull();
    expect(store.has("priv/biz1/form/b.pdf")).toBe(true);
  });
});

describe("public addresses", () => {
  it("round-trips a key through its CDN address", () => {
    const url = publicObjectUrl(cfg, "biz1/service/a b.webp");
    expect(url).toBe("https://images.example.com/biz1/service/a b.webp");
    expect(keyFromPublicUrl(cfg, "https://images.example.com/biz1/service/a%20b.webp?v=1")).toBe("biz1/service/a b.webp");
    expect(keyFromPublicUrl(cfg, "https://app.example.com/api/files/123")).toBeNull();
    expect(keyFromPublicUrl(cfg, null)).toBeNull();
  });
});
