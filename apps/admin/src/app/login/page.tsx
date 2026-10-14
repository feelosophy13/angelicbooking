import type { Metadata } from "next";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in" };

export const dynamic = "force-dynamic";

export default function LoginPage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center px-4">
      <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-xl bg-brand text-lg font-bold text-brand-ink">A</div>
      <h1 className="text-xl font-semibold">Platform admin</h1>
      <p className="mt-1 text-sm text-ink-2">Angelic Booking staff only.</p>
      <LoginForm needsCode={!!process.env.ADMIN_TOTP_SECRET} />
    </main>
  );
}
