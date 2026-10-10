import { notFound } from "next/navigation";
import { getReviewByToken } from "@/server/reviews";
import { ReviewForm } from "./form";
import { optOutOfReviews } from "./actions";

export default async function ReviewPage({ params, searchParams }: { params: Promise<{ slug: string; token: string }>; searchParams: Promise<{ rating?: string; optout?: string }> }) {
  const { slug, token } = await params;
  const sp = await searchParams;
  const r = await getReviewByToken(slug, token);
  if (!r) notFound();
  if (sp.optout === "1") {
    await optOutOfReviews(slug, token);
    return <div className="rounded-xl border border-stone-200 bg-white p-6 text-center text-sm text-stone-700">Got it. We won&apos;t ask you for reviews again.</div>;
  }
  const initial = /^[1-5]$/.test(sp.rating ?? "") ? Number(sp.rating) : null;
  return (
    <div className="rounded-xl border border-stone-200 bg-white p-6">
      {r.review.submittedAt ? (
        <p className="text-center text-sm text-stone-700">Thanks{r.client ? `, ${r.client.firstName}` : ""}! You already rated this visit {r.review.rating}/5.{r.review.rating && r.review.rating >= 4 && r.business.googleReviewUrl ? <> You can also <a href={r.business.googleReviewUrl} className="underline" style={{ color: "var(--brand)" }} target="_blank" rel="noreferrer">leave a Google review</a>.</> : null}</p>
      ) : (
        <>
          <h1 className="text-center text-xl font-semibold">How was your visit{r.client ? `, ${r.client.firstName}` : ""}?</h1>
          <p className="mb-4 text-center text-sm text-stone-600">{[r.serviceName, r.staffName ? `with ${r.staffName}` : null].filter(Boolean).join(" ")}</p>
          <ReviewForm slug={slug} token={token} initialRating={initial} googleReviewUrl={r.business.googleReviewUrl} businessName={r.business.name} />
        </>
      )}
    </div>
  );
}
