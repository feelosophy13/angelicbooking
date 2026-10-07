import { cookies } from "next/headers";

export type FlashKind = "success" | "error" | "info";
export interface Flash {
  kind: FlashKind;
  message: string;
}

const NAME = "angelic_flash";

/** Queue a one-time toast for the next page render. Call from server actions. */
export async function setFlash(message: string, kind: FlashKind = "success") {
  const jar = await cookies();
  jar.set(NAME, JSON.stringify({ kind, message } satisfies Flash), { path: "/", maxAge: 15, httpOnly: false, sameSite: "lax" });
}

/** Read (without clearing — the client clears it after showing). */
export async function readFlash(): Promise<Flash | null> {
  const raw = (await cookies()).get(NAME)?.value;
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Flash;
  } catch {
    return null;
  }
}

export const FLASH_COOKIE = NAME;
