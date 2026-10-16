"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/admin";
import { ActionError, extendTrial, reactivateTenant, setComped, suspendTenant } from "@/lib/tenant-actions";

export type ActionState = { ok?: string; error?: string } | null;

async function run(fn: (actor: string) => Promise<string>): Promise<ActionState> {
  const admin = await requireAdmin();
  try {
    const ok = await fn(admin.email);
    revalidatePath("/", "layout");
    return { ok };
  } catch (e) {
    if (e instanceof ActionError) return { error: e.message };
    throw e;
  }
}

export async function suspendAction(id: string, _p: ActionState, form: FormData): Promise<ActionState> {
  const reason = String(form.get("reason") ?? "").trim().slice(0, 300);
  return run(async (actor) => (await suspendTenant(id, reason, actor), "Suspended."));
}

export async function reactivateAction(id: string): Promise<ActionState> {
  return run(async (actor) => (await reactivateTenant(id, actor), "Reactivated."));
}

export async function compAction(id: string, comped: boolean): Promise<ActionState> {
  return run(async (actor) => (await setComped(id, comped, actor), comped ? "Comped." : "Comp removed."));
}

export async function extendTrialAction(id: string, _p: ActionState, form: FormData): Promise<ActionState> {
  const days = Number(String(form.get("days") ?? "").trim());
  return run(async (actor) => `Trial now ends ${(await extendTrial(id, days, actor)).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}.`);
}
