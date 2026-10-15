import type { Metadata } from "next";
import { googleEnabled } from "@/lib/google";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in" };
export const dynamic = "force-dynamic";

const NOTICES: Record<string, { tone: "good" | "bad"; text: string }> = {
  reset: { tone: "good", text: "Your password is changed. Sign in with it below." },
  google_denied: { tone: "bad", text: "That Google account isn't allowed to sign in here." },
  google_failed: { tone: "bad", text: "Google sign-in didn't complete. Please try again." },
};

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ notice?: string }> }) {
  const notice = NOTICES[(await searchParams).notice ?? ""];
  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center px-4">
      <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-xl bg-brand text-lg font-bold text-brand-ink">A</div>
      <h1 className="text-xl font-semibold">Platform admin</h1>
      <p className="mt-1 text-sm text-ink-2">Angelic Booking staff only.</p>
      {notice && <p role="status" className={`mt-4 rounded-lg px-3 py-2 text-sm ${notice.tone === "good" ? "bg-good-soft text-good" : "bg-bad-soft text-bad"}`}>{notice.text}</p>}
      {googleEnabled() && (
        <>
          <a href="/auth/google" className="mt-6 flex items-center justify-center gap-2.5 rounded-lg border border-line bg-surface px-3 py-2 text-sm font-medium hover:bg-surface-2">
            <svg viewBox="0 0 48 48" className="h-4 w-4" aria-hidden>
              <path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.5 5.4 2.6 13.2l7.9 6.1C12.4 13.5 17.7 9.5 24 9.5z" />
              <path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.7c-.6 3-2.3 5.5-4.8 7.2l7.5 5.8c4.4-4.1 7.1-10.1 7.1-17.5z" />
              <path fill="#FBBC05" d="M10.5 28.7c-.5-1.5-.8-3.1-.8-4.7s.3-3.2.8-4.7l-7.9-6.1C.9 16.4 0 20.1 0 24s.9 7.6 2.6 10.8l7.9-6.1z" />
              <path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.5-5.8c-2.1 1.4-4.9 2.3-8.4 2.3-6.3 0-11.6-4-13.5-9.8l-7.9 6.1C6.5 42.6 14.6 48 24 48z" />
            </svg>
            Continue with Google
          </a>
          <div className="my-4 flex items-center gap-3 text-xs text-ink-3"><span className="h-px flex-1 bg-line" />or<span className="h-px flex-1 bg-line" /></div>
        </>
      )}
      <LoginForm needsCode={!!process.env.ADMIN_TOTP_SECRET} />
    </main>
  );
}
