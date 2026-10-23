/**
 * The AI assistant with Claude mocked: the request the SDK gets (model, fallback, effort), usage logging and cost, the monthly limit,
 * refusals, hiding itself without a key, and that prompts never carry a client's phone number or email (nor their last name). The
 * database parts need Postgres at DATABASE_URL and are skipped otherwise; nothing reaches Anthropic.
 */
import "../../../../../packages/db/src/env";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { db, schema, withTenant } from "@angelic/db";
import { reachable, setupKit } from "@/lib/__tests__/api-test-kit";

// The SDK, replaced: records what it is asked and answers like the Messages API.
const sdkCalls: Record<string, unknown>[] = [];
vi.mock("@anthropic-ai/sdk", () => {
  class APIError extends Error {}
  class Anthropic {
    static APIError = APIError;
    static RateLimitError = class extends APIError {};
    static AuthenticationError = class extends APIError {};
    static APIConnectionError = class extends Error {};
    beta = {
      messages: {
        create: async (params: Record<string, unknown>) => {
          sdkCalls.push(params);
          return { model: "claude-opus-5-5", stop_reason: "end_turn", content: [{ type: "text", text: "  A lovely cut.  " }], usage: { input_tokens: 1000, output_tokens: 200, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } };
        },
      },
    };
  }
  return { default: Anthropic };
});

const ai = await import("@/server/ai");
const features = await import("@/server/ai-features");

describe("redactContact and parseDraft", () => {
  it("strips emails and phone numbers a client typed", () => {
    expect(ai.redactContact("Call me at (555) 123-4567 or mail ana.b@example.com, room 12")).toBe("Call me at [phone] or mail [email], room 12");
  });
  it("splits a campaign draft into subject and body", () => {
    expect(features.parseDraft("SUBJECT: Hello\nBODY: Hi {first_name},\nsee you", false)).toEqual({ subject: "Hello", body: "Hi {first_name},\nsee you" });
    expect(features.parseDraft("BODY: Short text", true)).toEqual({ subject: null, body: "Short text" });
  });
  it("prices a request in micro-dollars", () => {
    expect(ai.costMicros("claude-opus-5-5", { input_tokens: 1000, output_tokens: 200 })).toBe(1000 * 4 + 200 * 20);
    expect(ai.costMicros("claude-opus-5-5", { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 1000, cache_creation_input_tokens: 1000 })).toBe(400 + 5000);
  });
});

describe("hiding without a key", () => {
  it("is off when ANTHROPIC_API_KEY isn't set (and AI_FAKE is never honored in production)", () => {
    const saved = { key: process.env.ANTHROPIC_API_KEY, fake: process.env.AI_FAKE };
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.AI_FAKE;
    expect(ai.aiConfigured()).toBe(false);
    process.env.ANTHROPIC_API_KEY = "sk-test";
    expect(ai.aiConfigured()).toBe(true);
    if (saved.key === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = saved.key;
    if (saved.fake !== undefined) process.env.AI_FAKE = saved.fake;
  });
});

const up = await reachable();

describe.skipIf(!up)("aiText and the features", () => {
  let kit: Awaited<ReturnType<typeof setupKit>>;
  const savedKey = process.env.ANTHROPIC_API_KEY;
  const business = () => db.query.businesses.findFirst({ where: eq(schema.businesses.id, kit.A) }).then((b) => b!);
  const usage = () => withTenant(kit.A, (tx) => tx.select().from(schema.aiUsage));

  beforeAll(async () => {
    kit = await setupKit([]);
    process.env.ANTHROPIC_API_KEY = "sk-test-not-real";
  });
  afterEach(() => {
    ai.setAiClientForTests(null);
    sdkCalls.length = 0;
  });
  afterAll(async () => {
    if (savedKey === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = savedKey;
    await kit?.teardown();
  });

  it("asks the latest model through the SDK with fallback, low effort, and logs the cost", async () => {
    const text = await ai.aiText({ businessId: kit.A, feature: "service_description", system: "sys", messages: [{ role: "user", content: "hi" }], userId: "u1" });
    expect(text).toBe("A lovely cut.");
    expect(sdkCalls[0]).toMatchObject({ model: "claude-opus-5-5", fallbacks: "default", betas: ["server-side-fallback-2026-07-01"], output_config: { effort: "low" } });
    expect(sdkCalls[0]).not.toHaveProperty("temperature");
    const rows = await usage();
    expect(rows.map((r) => [r.feature, r.inputTokens, r.outputTokens, r.costMicros, r.userId])).toEqual([["service_description", 1000, 200, 8000, "u1"]]);
  });

  it("stops at the monthly limit", async () => {
    await db.update(schema.businesses).set({ aiMonthlyBudgetCents: 1 }).where(eq(schema.businesses.id, kit.A)); // 10,000 micro-dollars; 8,000 spent
    await ai.aiText({ businessId: kit.A, feature: "campaign", system: "s", messages: [{ role: "user", content: "x" }] });
    await expect(ai.aiText({ businessId: kit.A, feature: "campaign", system: "s", messages: [{ role: "user", content: "x" }] })).rejects.toThrow(/allowance is used up/);
    await db.update(schema.businesses).set({ aiMonthlyBudgetCents: 500 }).where(eq(schema.businesses.id, kit.A));
  });

  it("turns a refusal into a message for the screen (still logged)", async () => {
    ai.setAiClientForTests(async () => ({ text: "", model: "claude-opus-5-5", usage: { input_tokens: 10, output_tokens: 0 }, refused: true }));
    const before = (await usage()).length;
    await expect(ai.aiText({ businessId: kit.A, feature: "chatbot", system: "s", messages: [{ role: "user", content: "x" }] })).rejects.toBeInstanceOf(ai.AiError);
    expect((await usage()).length).toBe(before + 1);
  });

  it("suggests an Inbox reply without the client's phone, email or last name in the prompt", async () => {
    const seen: string[] = [];
    ai.setAiClientForTests(async (req) => {
      seen.push(req.system, JSON.stringify(req.messages));
      return { text: "Hi Ana! Yes, we're open Saturday.", model: "claude-opus-5-5", usage: { input_tokens: 1, output_tokens: 1 }, refused: false };
    });
    const clientId = await withTenant(kit.A, async (tx) => {
      const [c] = await tx.insert(schema.clients).values({ businessId: kit.A, firstName: "Ana", lastName: "Zyxwvut", phone: "+15555550177", email: "ana.private@example.invalid" }).returning({ id: schema.clients.id });
      await tx.insert(schema.inboundMessages).values({ businessId: kit.A, clientId: c!.id, fromNumber: "+15555550177", toNumber: "+15555550000", body: "Are you open Saturday? Text my other cell 555-867-5309 or ana.alt@example.invalid" });
      return c!.id;
    });
    const draft = await features.suggestReply(await business(), clientId, "u1");
    expect(draft).toBe("Hi Ana! Yes, we're open Saturday.");
    const prompt = seen.join("\n");
    expect(prompt).toContain("Ana");
    expect(prompt).toContain("Are you open Saturday?");
    for (const secret of ["5555550177", "555-0177", "ana.private", "867-5309", "ana.alt", "Zyxwvut"]) expect(prompt).not.toContain(secret);
  });

  it("answers booking-page questions from the salon's own menu, cached between turns", async () => {
    let req: Parameters<Parameters<typeof ai.setAiClientForTests>[0] & object>[0] | null = null;
    ai.setAiClientForTests(async (r) => {
      req = r;
      return { text: "A cut is $60.", model: "claude-opus-5-5", usage: { input_tokens: 1, output_tokens: 1 }, refused: false };
    });
    await withTenant(kit.A, (tx) => tx.insert(schema.services).values({ businessId: kit.A, name: "Signature Cut", durationMin: 45, priceCents: 6000 }));
    const answer = await features.chatAnswer(await business(), [{ role: "assistant", text: "Hi! Ask me anything." }, { role: "user", text: "How much is a cut?" }]);
    expect(answer).toBe("A cut is $60.");
    expect(req!.cacheSystem).toBe(true);
    expect(req!.system).toContain("Signature Cut");
    expect(req!.system).toContain("/book/");
    expect(req!.messages).toEqual([{ role: "user", content: "How much is a cut?" }]); // starts with the visitor
  });
});
