import { createAuthClient } from "better-auth/react";
import { expoClient } from "@better-auth/expo/client";
import { organizationClient } from "better-auth/client/plugins";
import * as SecureStore from "expo-secure-store";
import Constants from "expo-constants";

export const API_URL: string = (Constants.expoConfig?.extra?.apiUrl as string) ?? "http://localhost:3001";

export const authClient = createAuthClient({
  baseURL: API_URL,
  plugins: [expoClient({ scheme: "angelic", storagePrefix: "angelic", storage: SecureStore }), organizationClient()],
});

/** Fetch against the web app's mobile API with the stored session as a Bearer token. */
export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const cookie = await authClient.getCookie();
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (cookie) headers.Cookie = cookie;
  for (const [k, v] of Object.entries((init.headers as Record<string, string> | undefined) ?? {})) headers[k] = v;
  const res = await fetch(`${API_URL}${path}`, { ...init, headers });
  if (!res.ok) throw new Error((await res.json().catch(() => ({ error: res.statusText }))).error ?? res.statusText);
  return res.json() as Promise<T>;
}
