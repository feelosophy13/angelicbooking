"use server";
import { z } from "zod";
import { ClockError, punchWithPin, type Punch } from "@/server/time-clock";

export type PunchState = { error?: string; punch?: Punch } | undefined;

export async function punchAction(_prev: PunchState, formData: FormData): Promise<PunchState> {
  const d = z.object({ token: z.string().min(16), pin: z.string().trim() }).safeParse(Object.fromEntries(formData));
  if (!d.success) return { error: "Enter your PIN." };
  try {
    return { punch: await punchWithPin(d.data.token, d.data.pin) };
  } catch (e) {
    if (e instanceof ClockError) return { error: e.message };
    throw e;
  }
}
