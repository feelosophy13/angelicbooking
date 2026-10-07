"use client";
import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { authClient } from "@/lib/auth-client";
import { Button, Card, Field, Input, Notice } from "@/components/ui";
import { Wordmark } from "@/components/brand";

export function AuthForm({ mode, googleEnabled = false }: { mode: "sign-in" | "sign-up"; googleEnabled?: boolean }) {
  const router = useRouter();
  const params = useSearchParams();
  const [error, setError] = useState<string | null>(() => {
    const e = params.get("error");
    if (!e) return null;
    if (e === "access_denied") return "Google sign-in was cancelled.";
    if (e === "email_not_verified") return "Your Google email isn't verified. Verify it with Google or sign in with a password.";
    return "Google sign-in didn't complete. Please try again or use your password.";
  });
  const [busy, setBusy] = useState(false);
  const [googleBusy, setGoogleBusy] = useState(false);

  async function withGoogle() {
    setError(null);
    setGoogleBusy(true);
    const next = params.get("next") ?? "/";
    const res = await authClient.signIn.social({ provider: "google", callbackURL: next, errorCallbackURL: `/${mode}?error=oauth` });
    if (res.error) {
      setGoogleBusy(false);
      setError(res.error.message ?? "Google sign-in didn't start.");
    }
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    const fd = new FormData(e.currentTarget);
    const email = String(fd.get("email"));
    const password = String(fd.get("password"));
    const res =
      mode === "sign-up"
        ? await authClient.signUp.email({ email, password, name: String(fd.get("name")) })
        : await authClient.signIn.email({ email, password });
    setBusy(false);
    if (res.error) {
      setError(res.error.message ?? "Something went wrong");
      return;
    }
    if ((res.data as { twoFactorRedirect?: boolean } | null)?.twoFactorRedirect) return; // plugin redirects to /two-factor
    router.push(params.get("next") ?? "/");
    router.refresh();
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center p-6">
      <div className="mb-6 flex justify-center"><Wordmark /></div>
      <h1 className="mb-4 text-center text-xl font-semibold">
        {mode === "sign-up" ? "Create your account" : "Welcome back"}
      </h1>
      <Card className="p-6">
        {googleEnabled ? (
          <>
            <Button type="button" variant="secondary" className="w-full" onClick={withGoogle} disabled={googleBusy}>
              <GoogleMark /> {googleBusy ? "Opening Google…" : "Continue with Google"}
            </Button>
            <div className="my-4 flex items-center gap-3 text-xs uppercase tracking-wide text-stone-400">
              <span className="h-px flex-1 bg-stone-200" />or<span className="h-px flex-1 bg-stone-200" />
            </div>
          </>
        ) : null}
        <form onSubmit={onSubmit} className="space-y-4">
          {mode === "sign-up" ? (
            <Field label="Your name">
              <Input name="name" required autoComplete="name" />
            </Field>
          ) : null}
          <Field label="Email">
            <Input name="email" type="email" required autoComplete="email" />
          </Field>
          <Field label="Password">
            <Input name="password" type="password" required minLength={8} autoComplete={mode === "sign-up" ? "new-password" : "current-password"} />
          </Field>
          {mode === "sign-in" ? <div className="-mt-2 text-right"><Link href="/forgot-password" className="text-xs text-brand-700 underline">Forgot password?</Link></div> : null}
          {error ? <Notice>{error}</Notice> : null}
          <Button type="submit" className="w-full" disabled={busy}>
            {busy ? "…" : mode === "sign-up" ? "Create account" : "Sign in"}
          </Button>
        </form>
      </Card>
      <p className="mt-4 text-center text-sm text-stone-600">
        {mode === "sign-up" ? (
          <>Already have an account? <Link className="text-brand-600 underline" href="/sign-in">Sign in</Link></>
        ) : (
          <>New here? <Link className="text-brand-600 underline" href="/sign-up">Create an account</Link></>
        )}
      </p>
      <p className="mt-6 text-center text-xs text-stone-400">
        <Link href="/help" className="hover:text-stone-600">Help</Link> · <Link href="/privacy" className="hover:text-stone-600">Privacy</Link> · <Link href="/terms" className="hover:text-stone-600">Terms</Link>
      </p>
    </main>
  );
}

function GoogleMark() {
  return (
    <svg viewBox="0 0 48 48" className="h-4 w-4" aria-hidden="true">
      <path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.5 5.4 2.6 13.3l7.9 6.1C12.4 13.6 17.7 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.7c-.6 3-2.3 5.5-4.8 7.2l7.5 5.8c4.4-4.1 7.1-10.1 7.1-17.5z" />
      <path fill="#FBBC05" d="M10.5 28.6A14.6 14.6 0 0 1 9.7 24c0-1.6.3-3.1.8-4.6l-7.9-6.1A24 24 0 0 0 0 24c0 3.9.9 7.5 2.6 10.7l7.9-6.1z" />
      <path fill="#34A853" d="M24 48c6.3 0 11.7-2.1 15.6-5.7l-7.5-5.8c-2.1 1.4-4.8 2.3-8.1 2.3-6.3 0-11.6-4.1-13.5-9.8l-7.9 6.1C6.5 42.6 14.6 48 24 48z" />
    </svg>
  );
}
