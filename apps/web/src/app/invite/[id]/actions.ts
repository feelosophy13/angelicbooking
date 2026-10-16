"use server";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db, schema } from "@angelic/db";
import { auth } from "@/lib/auth";
import { getSession } from "@/lib/session";

export type AcceptState = { error?: string } | undefined;

export async function acceptInvite(_prev: AcceptState, formData: FormData): Promise<AcceptState> {
  const invitationId = String(formData.get("invitationId"));
  const h = await headers();
  const session = await getSession();
  if (!session?.user.emailVerified) return { error: "Confirm your email address first, then accept the invitation." };
  let slug: string | null = null;
  try {
    const res = await auth.api.acceptInvitation({ headers: h, body: { invitationId } });
    if (!res) return { error: "Could not accept invitation." };
    const biz = await db.query.businesses.findFirst({ where: eq(schema.businesses.id, res.invitation.organizationId) });
    slug = biz?.slug ?? null;
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Could not accept invitation." };
  }
  redirect(slug ? `/app/${slug}` : "/");
}

/** Send the verification email again, bringing them back to this invitation afterwards. */
export async function resendInviteVerification(formData: FormData) {
  const invitationId = String(formData.get("invitationId"));
  const session = await getSession();
  if (!session || session.user.emailVerified) return;
  await auth.api.sendVerificationEmail({ body: { email: session.user.email, callbackURL: `/invite/${invitationId}` } }).catch(() => undefined);
}
