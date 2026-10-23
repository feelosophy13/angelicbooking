"use server";
/**
 * The AI assistant's buttons in the staff app. Each returns a draft for the person to read and edit; none of them saves or sends
 * anything. Permission is the same as the screen the button sits on.
 */
import { z } from "zod";
import { requireAction } from "@/lib/tenant";
import { AiError, aiConfigured } from "@/server/ai";
import { categoryName, describeService, draftCampaign, draftFillMessage, suggestReply } from "@/server/ai-features";

type Draft<T = string> = { ok: true; value: T } | { ok: false; error: string };

async function run<T>(fn: () => Promise<T>): Promise<Draft<T>> {
  if (!aiConfigured()) return { ok: false, error: "The AI assistant isn't set up." };
  try {
    return { ok: true, value: await fn() };
  } catch (e) {
    if (e instanceof AiError) return { ok: false, error: e.message };
    console.error("[ai] request failed", e);
    return { ok: false, error: "Something went wrong. Try again." };
  }
}

const serviceInput = z.object({ name: z.string().trim().min(1).max(120), categoryId: z.string().max(60).nullish(), minutes: z.number().int().min(0).max(1440).nullish(), priceCents: z.number().int().min(0).nullish(), current: z.string().max(4000).nullish() });

export async function describeServiceAction(slug: string, input: z.infer<typeof serviceInput>): Promise<Draft> {
  const ctx = await requireAction(slug, "services.manage");
  const parsed = serviceInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Give the service a name first." };
  const d = parsed.data;
  return run(async () => describeService(ctx.business, { ...d, category: await categoryName(ctx.business.id, d.categoryId) }, ctx.user.id));
}

export async function draftCampaignAction(slug: string, input: { channel: "email" | "sms"; brief: string; subject?: string | null; body?: string | null }): Promise<Draft<{ subject: string | null; body: string }>> {
  const ctx = await requireAction(slug, "marketing.send");
  const d = z.object({ channel: z.enum(["email", "sms"]), brief: z.string().max(1000), subject: z.string().max(200).nullish(), body: z.string().max(4000).nullish() }).parse(input);
  return run(() => draftCampaign(ctx.business, d, ctx.user.id));
}

export async function draftFillMessageAction(slug: string, current: string | null): Promise<Draft> {
  const ctx = await requireAction(slug, "marketing.send");
  return run(() => draftFillMessage(ctx.business, (current ?? "").slice(0, 500), ctx.user.id));
}

export async function suggestReplyAction(slug: string, clientId: string): Promise<Draft> {
  // Same as sending a reply: reading the Inbox and editing clients.
  const ctx = await requireAction(slug, "clients.messages");
  await requireAction(slug, "clients.write");
  return run(() => suggestReply(ctx.business, z.string().min(1).max(60).parse(clientId), ctx.user.id));
}
