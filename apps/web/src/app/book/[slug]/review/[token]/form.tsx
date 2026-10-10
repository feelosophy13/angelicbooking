"use client";
import { useActionState, useState } from "react";
import { Notice, Textarea } from "@/components/ui";
import { SubmitButton } from "@/components/form";
import { submitReviewAction, type ReviewState } from "./actions";

export function ReviewForm({ slug, token, initialRating, googleReviewUrl, businessName }: { slug: string; token: string; initialRating: number | null; googleReviewUrl: string | null; businessName: string }) {
  const [state, action] = useActionState<ReviewState, FormData>(submitReviewAction, undefined);
  const [rating, setRating] = useState<number>(initialRating ?? 0);
  const [hover, setHover] = useState(0);
  if (state?.ok) {
    return (
      <div className="space-y-3 text-center">
        <p className="text-lg font-semibold">Thank you!</p>
        {state.rating && state.rating >= 4 && googleReviewUrl ? (
          <>
            <p className="text-sm text-stone-600">Would you share that on Google too? It helps {businessName} more than anything.</p>
            <a href={googleReviewUrl} target="_blank" rel="noreferrer" className="inline-block rounded-lg px-4 py-2 text-sm font-medium text-white" style={{ background: "var(--brand)" }}>Leave a Google review</a>
          </>
        ) : (
          <p className="text-sm text-stone-600">Your feedback goes straight to the team.</p>
        )}
      </div>
    );
  }
  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="slug" value={slug} />
      <input type="hidden" name="token" value={token} />
      <input type="hidden" name="rating" value={rating || ""} />
      <div className="flex justify-center gap-1" onMouseLeave={() => setHover(0)}>
        {[1, 2, 3, 4, 5].map((n) => (
          <button key={n} type="button" aria-label={`${n} star${n === 1 ? "" : "s"}`} onMouseEnter={() => setHover(n)} onClick={() => setRating(n)} className={`text-4xl transition-colors ${(hover || rating) >= n ? "text-amber-400" : "text-stone-300"}`}>★</button>
        ))}
      </div>
      <Textarea name="comment" rows={3} placeholder={rating && rating <= 3 ? "What could we do better?" : "Anything you'd like to add? (optional)"} />
      {state?.error ? <Notice>{state.error}</Notice> : null}
      <SubmitButton className="w-full" style={{ background: "var(--brand)" }} pendingText="Sending…" disabled={!rating}>Send</SubmitButton>
    </form>
  );
}
