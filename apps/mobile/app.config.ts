import type { ConfigContext, ExpoConfig } from "expo/config";

// This file runs in Node at build time; the app's tsconfig has no Node types.
declare const process: { env: Record<string, string | undefined> };

/**
 * Static settings live in app.json; this adds the web app's address the mobile app talks to.
 *
 * - `EXPO_PUBLIC_API_URL` wins when set (e.g. a LAN IP for a physical phone, or staging).
 * - Otherwise production builds (EAS "production" profile, or NODE_ENV=production) use the live app,
 *   and everything else uses the local dev server.
 */
const PRODUCTION_API_URL = "https://app.angelicbooking.com";
const DEV_API_URL = "http://localhost:3001";

function apiUrl(): string {
  const fromEnv = process.env.EXPO_PUBLIC_API_URL?.trim();
  if (fromEnv) return fromEnv.replace(/\/+$/, "");
  const production = process.env.EAS_BUILD_PROFILE === "production" || process.env.NODE_ENV === "production";
  return production ? PRODUCTION_API_URL : DEV_API_URL;
}

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...(config as ExpoConfig),
  extra: { ...config.extra, apiUrl: apiUrl() },
});
