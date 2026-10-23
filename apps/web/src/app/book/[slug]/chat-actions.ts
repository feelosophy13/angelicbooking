"use server";
import { headers } from "next/headers";
import { z } from "zod";
import { getPublicBusiness } from "@/server/public-booking";
import { AiError, aiConfigured } from "@/server/ai";
import { chatAnswer } from "@/server/ai-features";
import { clientIpFrom, CLIENT_IP_HEADER } from "@/lib/rate-limit";
import { sharedRateLimit } from "@/lib/shared-rate-limit";

const turns = z.array(z.object({ role: z.enum(["user", "assistant"]), text: z.string().max(2000) })).min(1).max(20);

/** The booking-page chat: one answer from the salon's public facts. Off unless the salon turned it on and the server has a key. */
export async function askChatAction(slug: string, history: { role: "user" | "assistant"; text: string }[]): Promise<{ ok: true; text: string } | { ok: false; error: string }> {
  const business = await getPublicBusiness(slug);
  if (!business || !business.aiChatbotEnabled || !aiConfigured()) return { ok: false, error: "Chat isn't available right now." };
  const parsed = turns.safeParse(history);
  if (!parsed.success) return { ok: false, error: "That message is too long." };
  const h = await headers();
  const ip = h.get(CLIENT_IP_HEADER) ?? clientIpFrom(h);
  // Per visitor and per salon, so a script can't run up the salon's AI bill (the monthly limit is the backstop).
  const [mine, all] = await Promise.all([sharedRateLimit(`chat:${business.id}:${ip}`, 20, 10 * 60_000), sharedRateLimit(`chat:${business.id}`, 300, 24 * 3_600_000)]);
  if (!mine.ok || !all.ok) return { ok: false, error: "Lots of questions right now. Please call us or try again in a few minutes." };
  try {
    return { ok: true, text: await chatAnswer(business, parsed.data) };
  } catch (e) {
    if (e instanceof AiError) return { ok: false, error: "Chat isn't available right now. Please call us or book online." };
    console.error("[chat] failed", e);
    return { ok: false, error: "Something went wrong. Please try again." };
  }
}
