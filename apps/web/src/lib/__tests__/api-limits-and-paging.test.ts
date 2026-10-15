/**
 * The API's limits and paging: the shared rate counter, the rate headers on every response, the body cap, and exact has_more.
 * The database tests need Postgres at DATABASE_URL and are skipped otherwise; the rest are pure.
 */
import "../../../../../packages/db/src/env"; // must come first: @angelic/db connects when imported, so DATABASE_URL has to be loaded already
import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { z } from "zod";
import { ApiTooLarge, list, pageParams, probe, readBody } from "../api";
import { sharedRateLimit } from "../shared-rate-limit";
import { call, reachable, send, setupKit } from "./api-test-kit";
import { GET as getServices } from "@/app/api/v1/services/route";
import { POST as postClient } from "@/app/api/v1/clients/route";

const up = await reachable();

describe("paging", () => {
  const p = { limit: 2, page: 1, offset: 0 };

  it("has_more is exact when the query fetched one extra row, and that row is not returned", async () => {
    const more = await list([1, 2, 3], p).json(); // the query fetched probe(p): limit + 1 rows
    expect(more).toEqual({ data: [1, 2], page: 1, limit: 2, has_more: true });
    const last = await list([1, 2], p).json();
    expect(last).toEqual({ data: [1, 2], page: 1, limit: 2, has_more: false });
  });

  it("with a counted total, has_more comes from the total", async () => {
    const body = await list([1, 2], { ...p, page: 2 }, 5).json();
    expect(body).toMatchObject({ total: 5, has_more: true });
    expect(await list([1], { ...p, page: 3 }, 5).json()).toMatchObject({ has_more: false });
  });

  it("probe asks for one more row and nothing else", () => {
    expect(probe(p)).toEqual({ limit: 3, page: 1, offset: 0 });
    expect(pageParams(new URL("http://x/?limit=500&page=0"))).toEqual({ limit: 100, page: 1, offset: 0 });
  });
});

describe("request body cap", () => {
  const schema = z.object({ notes: z.string().optional() });

  it("reads an ordinary JSON body", async () => {
    const req = new Request("http://x/api/v1/t", { method: "POST", body: '{"notes":"hi"}' });
    expect(await readBody(req, schema)).toEqual({ data: { notes: "hi" } });
  });

  it("refuses a body over 100 KB as it streams in, before it is parsed", async () => {
    const req = new Request("http://x/api/v1/t", { method: "POST", body: JSON.stringify({ notes: "x".repeat(120_000) }) });
    await expect(readBody(req, schema)).rejects.toBeInstanceOf(ApiTooLarge);
  });
});

describe.skipIf(!up)("rate limits (database)", () => {
  it("the shared counter stops at the limit and reports what is left", async () => {
    const key = `test:${crypto.randomUUID()}`;
    const a = await sharedRateLimit(key, 2, 60_000);
    const b = await sharedRateLimit(key, 2, 60_000);
    const c = await sharedRateLimit(key, 2, 60_000);
    expect([a.ok, a.remaining], "first call").toEqual([true, 1]);
    expect([b.ok, b.remaining], "second call").toEqual([true, 0]);
    expect(c.ok, "third call is over the limit").toBe(false);
    expect(c.resetAt).toBeGreaterThan(Math.floor(Date.now() / 1000));
  });

  describe("on the API", () => {
    let kit: Awaited<ReturnType<typeof setupKit>>;
    beforeAll(async () => {
      kit = await setupKit(["catalog:read", "clients:write"]);
    });
    afterAll(async () => {
      await kit.teardown();
    });

    it("every response carries the key's rate window", async () => {
      const res = await call(getServices, kit.key);
      expect(res.status).toBe(200);
      expect(res.headers.get("X-RateLimit-Limit")).toBe("120");
      expect(Number(res.headers.get("X-RateLimit-Remaining"))).toBeLessThanOrEqual(119);
      expect(Number(res.headers.get("X-RateLimit-Reset"))).toBeGreaterThan(Math.floor(Date.now() / 1000));
    });

    it("an oversized write is a 413 that says what the limit is", async () => {
      const res = await call(postClient, kit.key, {}, send("POST", { notes: "x".repeat(120_000) }));
      expect(res.status).toBe(413);
      expect((await res.json()).error.code).toBe("payload_too_large");
    });
  });
});
