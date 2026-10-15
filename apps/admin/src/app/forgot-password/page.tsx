import type { Metadata } from "next";
import Link from "next/link";
import { ForgotForm } from "./forgot-form";

export const metadata: Metadata = { title: "Forgot password" };

export default function ForgotPage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center px-4">
      <h1 className="text-xl font-semibold">Reset your password</h1>
      <p className="mt-1 text-sm text-ink-2">Enter the admin email and we&apos;ll send a link to choose a new password.</p>
      <ForgotForm />
      <p className="mt-6 text-center text-sm"><Link href="/login" className="text-ink-2 underline hover:text-ink">Back to sign in</Link></p>
    </main>
  );
}
