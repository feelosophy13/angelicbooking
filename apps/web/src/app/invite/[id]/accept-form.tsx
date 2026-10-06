"use client";
import { useActionState } from "react";
import { acceptInvite, type AcceptState } from "./actions";
import { Button, Notice } from "@/components/ui";

export function AcceptForm({ invitationId }: { invitationId: string }) {
  const [state, action, pending] = useActionState<AcceptState, FormData>(acceptInvite, undefined);
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="invitationId" value={invitationId} />
      {state?.error ? <Notice>{state.error}</Notice> : null}
      <Button type="submit" className="w-full" disabled={pending}>{pending ? "Joining…" : "Accept and join"}</Button>
    </form>
  );
}
