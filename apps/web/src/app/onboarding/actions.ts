"use server";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { requireSession } from "@/lib/session";
import { slugify, TIMEZONES } from "@/lib/utils";

const schema = z.object({
  name: z.string().trim().min(2).max(80),
  timezone: z.string().refine((t) => TIMEZONES.includes(t), "Pick a timezone"),
});

export type OnboardingState = { error?: string } | undefined;

export async function createBusiness(_prev: OnboardingState, formData: FormData): Promise<OnboardingState> {
  await requireSession();
  const parsed = schema.safeParse({ name: formData.get("name"), timezone: formData.get("timezone") });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };

  const base = slugify(parsed.data.name) || "business";
  const h = await headers();
  let slug = base;
  for (let i = 0; i < 5; i++) {
    const check = await auth.api.checkOrganizationSlug({ headers: h, body: { slug } }).catch(() => ({ status: false }));
    if (check?.status) break;
    slug = `${base}-${Math.random().toString(36).slice(2, 6)}`;
  }

  try {
    const org = await auth.api.createOrganization({
      headers: h,
      body: { name: parsed.data.name, slug, metadata: { timezone: parsed.data.timezone } },
    });
    if (!org) return { error: "Could not create business" };
    await auth.api.setActiveOrganization({ headers: h, body: { organizationId: org.id } });
    redirect(`/app/${org.slug}`);
  } catch (e) {
    if (isRedirectError(e)) throw e;
    return { error: e instanceof Error ? e.message : "Could not create business" };
  }
}

function isRedirectError(e: unknown): boolean {
  return typeof e === "object" && e !== null && "digest" in e && String((e as { digest: unknown }).digest).startsWith("NEXT_REDIRECT");
}
