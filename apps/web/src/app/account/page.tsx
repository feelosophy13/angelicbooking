import type { Metadata } from "next";
import Link from "next/link";
import { headers } from "next/headers";
import { Laptop, MailCheck, MailWarning } from "lucide-react";
import { auth } from "@/lib/auth";
import { requireSession } from "@/lib/session";
import { listMyBusinesses } from "@/lib/tenant";
import { relative } from "@/lib/format";
import { Wordmark } from "@/components/brand";
import { Button, Card, Input, PageHeader } from "@/components/ui";
import { ActionForm, ConfirmSubmit, Field, SubmitButton } from "@/components/form";
import { changePassword, resendVerification, revokeOtherSessions, revokeSession, setPassword, updateName } from "./actions";
import { ConnectedAccounts } from "./connected-accounts";
import { googleEnabled } from "@/lib/auth-providers";
import { TwoFactorCard } from "./two-factor-card";

export const metadata: Metadata = { title: "Account" };

export default async function AccountPage() {
  const session = await requireSession();
  const h = await headers();
  const [sessions, mine, accounts] = await Promise.all([auth.api.listSessions({ headers: h }), listMyBusinesses(session.user.id), auth.api.listUserAccounts({ headers: h })]);
  const hasPassword = accounts.some((a) => a.providerId === "credential");
  const google = accounts.find((a) => a.providerId === "google");
  const user = session.user as typeof session.user & { twoFactorEnabled?: boolean | null };
  const back = mine[0] ? `/app/${mine[0].slug}` : "/";
  return (
    <div className="min-h-screen bg-stone-50">
      <header className="border-b border-stone-200 bg-white">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-4 py-3">
          <Link href={back}><Wordmark /></Link>
          <Link href={back} className="text-sm text-brand-700 underline">Back to the app</Link>
        </div>
      </header>
      <main className="mx-auto max-w-3xl space-y-6 px-4 py-8">
        <PageHeader title="Your account" />
        <div className="grid gap-6 md:grid-cols-2">
          <Card className="p-5">
            <h2 className="mb-3 font-medium">Profile</h2>
            <ActionForm action={updateName}>
              <Field label="Name" name="name" required><Input name="name" defaultValue={user.name} required /></Field>
              <Field label="Email" hint="Email changes are handled by support for now."><Input value={user.email} readOnly className="bg-stone-50 text-stone-500" /></Field>
              <div className="flex items-center gap-2 text-sm">
                {user.emailVerified ? <><MailCheck className="h-4 w-4 text-emerald-600" /> <span className="text-emerald-700">Email verified</span></> : <><MailWarning className="h-4 w-4 text-amber-600" /> <span className="text-amber-700">Email not verified</span></>}
              </div>
              <SubmitButton variant="secondary" pendingText="Saving…">Save</SubmitButton>
            </ActionForm>
            {!user.emailVerified ? (
              <form action={resendVerification} className="mt-3"><Button type="submit" variant="ghost" size="sm">Resend verification email</Button></form>
            ) : null}
          </Card>
          <ConnectedAccounts googleEnabled={googleEnabled} googleLinked={!!google} hasPassword={hasPassword} googleAccountId={google?.accountId ?? null} />
          <Card className="p-5">
            <h2 className="mb-3 font-medium">{hasPassword ? "Change password" : "Set a password"}</h2>
            {hasPassword ? (
            <ActionForm action={changePassword}>
              <Field label="Current password" name="currentPassword" required><Input name="currentPassword" type="password" autoComplete="current-password" required /></Field>
              <Field label="New password" name="newPassword" required hint="At least 8 characters."><Input name="newPassword" type="password" autoComplete="new-password" required minLength={8} /></Field>
              <Field label="Confirm new password" name="confirm" required><Input name="confirm" type="password" autoComplete="new-password" required /></Field>
              <SubmitButton variant="secondary" pendingText="Changing…">Change password</SubmitButton>
            </ActionForm>
            ) : (
            <ActionForm action={setPassword}>
              <p className="mb-3 text-sm text-stone-600">You signed up with Google. Add a password so you can also sign in with your email.</p>
              <Field label="New password" name="newPassword" required hint="At least 8 characters."><Input name="newPassword" type="password" autoComplete="new-password" required minLength={8} /></Field>
              <Field label="Confirm password" name="confirm" required><Input name="confirm" type="password" autoComplete="new-password" required /></Field>
              <SubmitButton variant="secondary" pendingText="Saving…">Set password</SubmitButton>
            </ActionForm>
            )}
          </Card>
          <TwoFactorCard enabled={!!user.twoFactorEnabled} />
          <Card className="p-5">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="font-medium">Signed-in devices</h2>
              {sessions.length > 1 ? <form action={revokeOtherSessions}><ConfirmSubmit title="Sign out all other devices?" confirmLabel="Sign out others" variant="ghost">Sign out others</ConfirmSubmit></form> : null}
            </div>
            <ul className="divide-y divide-stone-100 text-sm">
              {sessions.map((s) => {
                const current = s.token === session.session.token;
                return (
                  <li key={s.id} className="flex items-center gap-3 py-2">
                    <Laptop className="h-4 w-4 text-stone-400" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate">{describeAgent(s.userAgent)}{current ? <span className="ml-2 rounded bg-brand-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-brand-700">This device</span> : null}</p>
                      <p className="text-xs text-stone-500">{describeIp(s.ipAddress)} · active {relative(s.updatedAt)} · expires {relative(s.expiresAt)}</p>
                    </div>
                    {!current ? <form action={revokeSession}><input type="hidden" name="token" value={s.token} /><Button size="sm" variant="ghost" type="submit">Sign out</Button></form> : null}
                  </li>
                );
              })}
            </ul>
          </Card>
        </div>
        <p className="text-xs text-stone-500">You belong to {mine.length} business{mine.length === 1 ? "" : "es"}: {mine.map((b) => b.name).join(", ")}.</p>
      </main>
    </div>
  );
}

function describeAgent(ua: string | null | undefined) {
  if (!ua) return "Unknown device";
  const browser = /Edg\//.test(ua) ? "Edge" : /Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : /Firefox\//.test(ua) ? "Firefox" : "Browser";
  const os = /iPhone|iPad/.test(ua) ? "iOS" : /Android/.test(ua) ? "Android" : /Mac OS X/.test(ua) ? "macOS" : /Windows/.test(ua) ? "Windows" : /Linux/.test(ua) ? "Linux" : "";
  return `${browser}${os ? ` on ${os}` : ""}`;
}

function describeIp(ip: string | null | undefined) {
  if (!ip) return "Unknown location";
  if (ip === "::1" || ip === "127.0.0.1" || /^0{4}(:0{4}){6}:0{3}1$/.test(ip)) return "This computer";
  return ip;
}
