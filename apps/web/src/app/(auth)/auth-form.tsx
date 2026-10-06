"use client";
import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { authClient } from "@/lib/auth-client";
import { Button, Card, Field, Input, Notice } from "@/components/ui";

export function AuthForm({ mode }: { mode: "sign-in" | "sign-up" }) {
  const router = useRouter();
  const params = useSearchParams();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

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
    router.push(params.get("next") ?? "/");
    router.refresh();
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center p-6">
      <h1 className="mb-6 text-center text-2xl font-semibold">
        {mode === "sign-up" ? "Create your account" : "Welcome back"}
      </h1>
      <Card className="p-6">
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
    </main>
  );
}
