"use server";
import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@angelic/db";
import { requireAction } from "@/lib/tenant";
import { f, formAction } from "@/lib/form";

const url = z.string().trim().max(500).refine((v) => !v || /^https?:\/\/\S+$/i.test(v), "Enter a full URL starting with https://").transform((v) => v || null);

export const saveProfile = formAction(
  z.object({
    slug: z.string(),
    tagline: f.optional(120),
    about: f.optional(1500),
    logoUrl: url,
    coverUrl: url,
    brandColor: z.string().trim().regex(/^#[0-9a-fA-F]{6}$/, "Pick a colour"),
    website: url,
    instagram: z.string().trim().max(60).transform((v) => v.replace(/^@/, "").replace(/^https?:\/\/(www\.)?instagram\.com\//i, "").replace(/\/$/, "") || null),
    hoursText: f.optional(600),
  }),
  async (d) => {
    const ctx = await requireAction(d.slug, "business.manage");
    await db
      .update(schema.businesses)
      .set({ tagline: d.tagline, about: d.about, logoUrl: d.logoUrl, coverUrl: d.coverUrl, brandColor: d.brandColor.toLowerCase() === "#6d28d9" ? null : d.brandColor, website: d.website, instagram: d.instagram, hoursText: d.hoursText })
      .where(eq(schema.businesses.id, ctx.business.id));
    revalidatePath(`/app/${d.slug}/settings/profile`);
    revalidatePath(`/book/${ctx.business.slug}`, "layout");
    return "Profile saved";
  },
);
