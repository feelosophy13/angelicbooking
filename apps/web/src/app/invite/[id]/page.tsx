import { eq } from "drizzle-orm";
import { db, schema } from "@angelic/db";
import { getSession } from "@/lib/session";
import { Card, LinkButton } from "@/components/ui";
import { AcceptForm } from "./accept-form";

export default async function InvitePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [inv] = await db
    .select({
      id: schema.invitation.id,
      email: schema.invitation.email,
      role: schema.invitation.role,
      status: schema.invitation.status,
      expiresAt: schema.invitation.expiresAt,
      businessName: schema.organization.name,
    })
    .from(schema.invitation)
    .innerJoin(schema.organization, eq(schema.organization.id, schema.invitation.organizationId))
    .where(eq(schema.invitation.id, id));
  const session = await getSession();
  const next = `/invite/${id}`;

  const shell = (body: React.ReactNode) => (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center p-6">
      <Card className="p-6">{body}</Card>
    </main>
  );

  if (!inv) return shell(<p className="text-stone-700">This invitation link is not valid.</p>);
  if (inv.status !== "pending" || inv.expiresAt < new Date()) {
    return shell(<p className="text-stone-700">This invitation has {inv.status === "pending" ? "expired" : `been ${inv.status}`}. Ask the business to send a new one.</p>);
  }

  const head = (
    <>
      <h1 className="text-xl font-semibold">Join {inv.businessName}</h1>
      <p className="mb-4 mt-1 text-sm text-stone-600">
        You&apos;ve been invited as <span className="font-medium">{inv.role?.replace("_", " ")}</span>. Invitation sent to {inv.email}.
      </p>
    </>
  );

  if (!session) {
    return shell(
      <>
        {head}
        <p className="mb-3 text-sm text-stone-600">Sign in or create an account with that email to accept.</p>
        <div className="flex gap-2">
          <LinkButton href={`/sign-up?next=${encodeURIComponent(next)}`} variant="primary" className="flex-1">Create account</LinkButton>
          <LinkButton href={`/sign-in?next=${encodeURIComponent(next)}`} className="flex-1">Sign in</LinkButton>
        </div>
      </>,
    );
  }

  if (session.user.email.toLowerCase() !== inv.email.toLowerCase()) {
    return shell(
      <>
        {head}
        <p className="text-sm text-red-700">You&apos;re signed in as {session.user.email}, but this invitation is for {inv.email}. Sign out and use the invited email.</p>
      </>,
    );
  }

  return shell(
    <>
      {head}
      <AcceptForm invitationId={inv.id} />
    </>,
  );
}
