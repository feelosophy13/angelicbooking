/**
 * Development only: look at the app as another role without signing out, to see what a manager, front desk or provider gets.
 * The choice is a cookie that `requireBusiness` reads, so every page, menu and permission check behaves as that role.
 * It is never active in production or on Render: with those, the cookie is ignored and the switcher is not drawn.
 */
export const VIEW_AS_COOKIE = "dev-view-as";

export function viewAsEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.NODE_ENV !== "production" && !env.RENDER && !env.VERCEL;
}
