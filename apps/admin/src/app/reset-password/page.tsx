import type { Metadata } from "next";
import Link from "next/link";
import { findAdminByEmail } from "@/lib/credentials";
import { peekEmail, verifyResetToken } from "@/lib/reset-token";
import { ResetForm } from "./reset-form";

export const metadata: Metadata = { title: "Choose a new password" };
export const dynamic = "force-dynamic";

export default async function ResetPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const token = (await searchParams).token ?? "";
  const secret = process.env.ADMIN_SESSION_SECRET;
  const peeked = peekEmail(token);
  const user = peeked ? await findAdminByEmail(peeked) : null;
  const valid = !!secret && !!user && !user.disabledAt && !!verifyResetToken(secret, token, user.passwordHash ?? "");
  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center px-4">
      {valid ? (
        <>
          <h1 className="text-xl font-semibold">Choose a new password</h1>
          <p className="mt-1 text-sm text-ink-2">At least 12 characters. A passphrase of a few words works well.</p>
          <ResetForm token={token} />
        </>
      ) : (
        <>
          <h1 className="text-xl font-semibold">This link no longer works</h1>
          <p className="mt-1 text-sm text-ink-2">Reset links work once and expire after 30 minutes.</p>
          <Link href="/forgot-password" className="mt-6 rounded-lg bg-brand px-3 py-2 text-center text-sm font-medium text-brand-ink hover:opacity-90">Get a new link</Link>
        </>
      )}
    </main>
  );
}
