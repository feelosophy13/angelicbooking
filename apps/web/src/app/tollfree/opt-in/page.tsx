import type { Metadata } from "next";
import { SmsConsent } from "@/app/book/[slug]/forms";
import { Field, Input } from "@/components/ui";

export const metadata: Metadata = { title: "SMS opt-in sample", robots: { index: false } };

/**
 * Static rendering of the booking page's contact step, used to produce the
 * opt-in screenshot attached to every toll-free verification
 * (public/tollfree/opt-in.png). Regenerate after changing the consent wording:
 *   pnpm --filter @angelic/web exec playwright screenshot --viewport-size=720,520 \
 *     http://localhost:3001/tollfree/opt-in public/tollfree/opt-in.png
 */
export default function OptInSamplePage() {
  return (
    <main className="mx-auto max-w-md p-6">
      <div className="mb-3 text-sm text-stone-500">Book at <span className="font-medium text-stone-900">Your Salon</span> · Haircut with Jamie · Tue, Oct 14, 2:00 PM</div>
      <div className="space-y-3 rounded-xl border border-stone-200 bg-white p-4">
        <div className="grid grid-cols-2 gap-3">
          <Field label="First name"><Input defaultValue="Alex" readOnly /></Field>
          <Field label="Last name"><Input defaultValue="Rivera" readOnly /></Field>
        </div>
        <Field label="Mobile number"><Input defaultValue="(555) 010-1234" readOnly /></Field>
        <Field label="Email"><Input defaultValue="alex@example.com" readOnly /></Field>
        <SmsConsent />
        <button type="button" className="h-10 w-full rounded-lg bg-stone-900 text-sm font-medium text-white">Confirm booking</button>
      </div>
    </main>
  );
}
