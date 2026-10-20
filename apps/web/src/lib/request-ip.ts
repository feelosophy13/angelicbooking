import { headers } from "next/headers";

/** The caller's IP address (first hop of x-forwarded-for behind Render's proxy). Helcim asks for one on every payment call. */
export async function requestIp(): Promise<string> {
  const h = await headers();
  return h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || "127.0.0.1";
}
