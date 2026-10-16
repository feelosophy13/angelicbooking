import { afterEach, describe, expect, it } from "vitest";
import { botCheckOn, verifyTurnstile } from "../turnstile";

const saved = process.env.TURNSTILE_SECRET_KEY;
afterEach(() => {
  if (saved === undefined) delete process.env.TURNSTILE_SECRET_KEY;
  else process.env.TURNSTILE_SECRET_KEY = saved;
});

const reply = (body: unknown, ok = true) => (async () => ({ ok, json: async () => body }) as Response) as unknown as typeof fetch;

describe("verifyTurnstile", () => {
  it("lets everything through when no secret is configured", async () => {
    delete process.env.TURNSTILE_SECRET_KEY;
    expect(await verifyTurnstile(null)).toBe(true);
  });
  it("needs a token, and Cloudflare's yes", async () => {
    process.env.TURNSTILE_SECRET_KEY = "secret";
    expect(await verifyTurnstile(undefined, null, reply({ success: true }))).toBe(false);
    expect(await verifyTurnstile("tok", null, reply({ success: true }))).toBe(true);
    expect(await verifyTurnstile("tok", null, reply({ success: false }))).toBe(false);
    expect(await verifyTurnstile("tok", null, reply({}, false))).toBe(false);
  });
  it("treats a network failure as a fail", async () => {
    process.env.TURNSTILE_SECRET_KEY = "secret";
    expect(await verifyTurnstile("tok", null, (async () => { throw new Error("down"); }) as unknown as typeof fetch)).toBe(false);
  });
});

describe("botCheckOn", () => {
  const env = { TURNSTILE_SECRET_KEY: "s", NEXT_PUBLIC_TURNSTILE_SITE_KEY: "k" };
  it("is on for the hosts registered on the widget, off for a business's own domain", () => {
    expect(botCheckOn("app.angelicbooking.com", env)).toBe(true);
    expect(botCheckOn("localhost:3001", env)).toBe(true);
    expect(botCheckOn("book.somesalon.com", env)).toBe(false);
    expect(botCheckOn("book.somesalon.com", { ...env, NEXT_PUBLIC_TURNSTILE_HOSTNAMES: "app.angelicbooking.com, book.somesalon.com" })).toBe(true);
  });
  it("is off until both keys are set", () => {
    expect(botCheckOn("app.angelicbooking.com", { TURNSTILE_SECRET_KEY: "s" })).toBe(false);
    expect(botCheckOn("app.angelicbooking.com", {})).toBe(false);
  });
});
