/**
 * The AI assistant: Claude through the Anthropic SDK, called only from the server. Every feature (service descriptions, marketing copy,
 * Fill My Books invitations, Inbox reply suggestions, the booking-page chat) goes through aiText(), which
 *   - does nothing unless ANTHROPIC_API_KEY is set (aiConfigured() hides every AI control otherwise);
 *   - stops a business at its monthly allowance (businesses.ai_monthly_budget_cents) before calling;
 *   - logs every request's tokens and cost in ai_usage;
 *   - is handed only what the feature needs. Callers never put a client's phone number or email address in a prompt, and text a
 *     client typed goes through redactContact() first.
 * In development, AI_FAKE=1 answers with canned text so the screens can be tried without a key (never in production).
 * Cost and setup: docs-ops.md → AI assistant.
 */
import Anthropic from "@anthropic-ai/sdk";
import { and, eq, gte, sql } from "drizzle-orm";
import { db, schema, withTenant } from "@angelic/db";

export const AI_MODEL = "claude-opus-5-5";

export type AiFeature = "service_description" | "campaign" | "fill_invite" | "inbox_reply" | "chatbot";

export const AI_FEATURE_LABELS: Record<AiFeature, string> = {
  service_description: "Service descriptions",
  campaign: "Campaign copy",
  fill_invite: "Fill My Books wording",
  inbox_reply: "Inbox reply suggestions",
  chatbot: "Booking-page chat",
};

/** US dollars per million tokens: [input, output]. Cache reads are a tenth of input, cache writes 1.25×. Unknown models cost as Opus 5.5. */
const PRICES: Record<string, [number, number]> = {
  "claude-opus-5-5": [4, 20],
  "claude-opus-5": [5, 25],
  "claude-opus-4-8": [5, 25],
};

export class AiError extends Error {}

const fakeAi = () => process.env.AI_FAKE === "1" && process.env.NODE_ENV !== "production";

/** Whether the AI features are available at all on this server. */
export function aiConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY) || fakeAi() || override !== null;
}

export type AiUsage = { input_tokens: number; output_tokens: number; cache_read_input_tokens?: number | null; cache_creation_input_tokens?: number | null };
export type AiRequest = { system: string; messages: Anthropic.Beta.BetaMessageParam[]; maxTokens: number; cacheSystem: boolean; feature: AiFeature };
export type AiResult = { text: string; model: string; usage: AiUsage; refused: boolean };
export type AiClient = (req: AiRequest) => Promise<AiResult>;

let override: AiClient | null = null;
/** Tests swap the model out; pass null to restore. */
export function setAiClientForTests(client: AiClient | null) {
  override = client;
}

let sdk: Anthropic | null = null;
const anthropicClient: AiClient = async (req) => {
  // Interactive screens wait on this, so one retry and a minute at most.
  sdk ??= new Anthropic({ timeout: 60_000, maxRetries: 1 });
  const res = await sdk.beta.messages.create({
    model: AI_MODEL,
    max_tokens: req.maxTokens,
    // A declined request is retried server-side on the model Anthropic recommends for that kind of refusal.
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    // Short copywriting and answers: low effort keeps them quick and cheap.
    output_config: { effort: "low" },
    system: [{ type: "text", text: req.system, ...(req.cacheSystem ? { cache_control: { type: "ephemeral" as const } } : {}) }],
    messages: req.messages,
  });
  const text = res.content.map((b) => (b.type === "text" ? b.text : "")).join("").trim();
  return { text, model: res.model, usage: res.usage, refused: res.stop_reason === "refusal" };
};

/** Canned answers for AI_FAKE=1, so the screens work on a laptop without a key. Each says it is a placeholder. */
const fakeClient: AiClient = async (req) => {
  const lastUser = [...req.messages].reverse().find((m) => m.role === "user");
  const asked = typeof lastUser?.content === "string" ? lastUser.content : "";
  const texts: Record<AiFeature, string> = {
    service_description: "A relaxing, precise service tailored to you. Your stylist starts with a quick consultation, then works carefully so you leave looking polished and feeling great. (Sample text: AI_FAKE is on.)",
    campaign: "SUBJECT: A little something for you this month\nBODY: Hi {first_name}, it's been a while and we'd love to see you. Book this month and treat yourself to some time just for you: {booking_url} (Sample text: AI_FAKE is on.)",
    fill_invite: "Hi {first_name}! {staff} just had a spot open up {when} for {service}. Want it? Tap to grab it: {link}",
    inbox_reply: "Hi! Thanks for your message. Let me check and get right back to you. (Sample reply: AI_FAKE is on.)",
    chatbot: `Thanks for asking! This is a sample answer because AI_FAKE is on. You asked: "${asked.slice(0, 80)}"`,
  };
  return { text: texts[req.feature], model: "fake", usage: { input_tokens: 0, output_tokens: 0 }, refused: false };
};

/** Cost of one request in millionths of a dollar. */
export function costMicros(model: string, u: AiUsage): number {
  if (model === "fake") return 0;
  const [inp, out] = PRICES[model] ?? PRICES[AI_MODEL]!;
  // $/MTok equals micro-dollars per token.
  return Math.ceil(u.input_tokens * inp + u.output_tokens * out + (u.cache_read_input_tokens ?? 0) * inp * 0.1 + (u.cache_creation_input_tokens ?? 0) * inp * 1.25);
}

const monthStart = (now: Date) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));

/** Spent this calendar month (UTC), in micro-dollars. */
export async function monthSpendMicros(businessId: string, now = new Date()): Promise<number> {
  const [row] = await withTenant(businessId, (tx) => tx.select({ n: sql<number>`coalesce(sum(${schema.aiUsage.costMicros}), 0)` }).from(schema.aiUsage).where(gte(schema.aiUsage.createdAt, monthStart(now))));
  return Number(row?.n ?? 0);
}

/** This month's requests and cost per feature, for Settings → AI assistant. */
export async function monthUsage(businessId: string, now = new Date()) {
  const rows = await withTenant(businessId, (tx) =>
    tx
      .select({ feature: schema.aiUsage.feature, requests: sql<number>`count(*)`, micros: sql<number>`coalesce(sum(${schema.aiUsage.costMicros}), 0)` })
      .from(schema.aiUsage)
      .where(and(gte(schema.aiUsage.createdAt, monthStart(now))))
      .groupBy(schema.aiUsage.feature),
  );
  return rows.map((r) => ({ feature: r.feature as AiFeature, requests: Number(r.requests), micros: Number(r.micros) }));
}

/** Email addresses and phone-number-like runs of digits in text a client typed, replaced before it goes into a prompt. */
export function redactContact(text: string): string {
  return text
    .replace(/[^\s@<>()]+@[^\s@<>()]+\.[a-z]{2,}/gi, "[email]")
    .replace(/(?:\+|\()?\d[\d\s().-]{6,}\d/g, (m) => (m.replace(/\D/g, "").length >= 7 ? "[phone]" : m));
}

/**
 * One Claude request for a business. Throws AiError with a message fit for the screen when the assistant is off, the month's allowance
 * is used up, or Claude declined.
 */
export async function aiText(input: { businessId: string; feature: AiFeature; system: string; messages: Anthropic.Beta.BetaMessageParam[]; maxTokens?: number; userId?: string | null; cacheSystem?: boolean }): Promise<string> {
  if (!aiConfigured()) throw new AiError("The AI assistant isn't set up on this server.");
  const biz = await db.query.businesses.findFirst({ where: eq(schema.businesses.id, input.businessId), columns: { aiMonthlyBudgetCents: true } });
  if (!biz) throw new AiError("Business not found.");
  if ((await monthSpendMicros(input.businessId)) >= biz.aiMonthlyBudgetCents * 10_000) throw new AiError("This month's AI allowance is used up. The owner can raise it under Settings → AI assistant.");
  const client = override ?? (process.env.ANTHROPIC_API_KEY ? anthropicClient : fakeClient);
  let res: AiResult;
  try {
    res = await client({ system: input.system, messages: input.messages, maxTokens: input.maxTokens ?? 4000, cacheSystem: input.cacheSystem ?? false, feature: input.feature });
  } catch (e) {
    if (e instanceof Anthropic.RateLimitError) throw new AiError("The AI assistant is busy right now. Try again in a minute.");
    if (e instanceof Anthropic.AuthenticationError) throw new AiError("The AI assistant's key was refused. Check ANTHROPIC_API_KEY.");
    if (e instanceof Anthropic.APIError || e instanceof Anthropic.APIConnectionError) throw new AiError("The AI assistant couldn't be reached. Try again.");
    throw e;
  }
  await withTenant(input.businessId, (tx) =>
    tx.insert(schema.aiUsage).values({
      businessId: input.businessId,
      feature: input.feature,
      model: res.model,
      inputTokens: res.usage.input_tokens,
      outputTokens: res.usage.output_tokens,
      cacheReadTokens: res.usage.cache_read_input_tokens ?? 0,
      cacheWriteTokens: res.usage.cache_creation_input_tokens ?? 0,
      costMicros: costMicros(res.model, res.usage),
      userId: input.userId ?? null,
    }),
  );
  if (res.refused || !res.text) throw new AiError("The assistant couldn't help with that one. Try rewording it.");
  return res.text;
}
