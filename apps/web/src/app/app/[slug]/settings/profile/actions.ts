"use server";
import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@angelic/db";
import { requireAction } from "@/lib/tenant";
import { f, formAction, FormError } from "@/lib/form";
import { deleteFileByUrl, FileError, storeImage } from "@/lib/files";

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
  async (d, raw) => {
    const ctx = await requireAction(d.slug, "business.manage");
    // Uploaded files win over typed URLs; old uploads are removed.
    let logoUrl = d.logoUrl;
    let coverUrl = d.coverUrl;
    try {
      const logo = raw.get("logoFile");
      if (logo instanceof File && logo.size > 0) {
        logoUrl = (await storeImage(ctx.business.id, "logo", logo)).url;
        await deleteFileByUrl(ctx.business.logoUrl);
      }
      const cover = raw.get("coverFile");
      if (cover instanceof File && cover.size > 0) {
        coverUrl = (await storeImage(ctx.business.id, "cover", cover)).url;
        await deleteFileByUrl(ctx.business.coverUrl);
      }
    } catch (e) {
      if (e instanceof FileError) throw new FormError(e.message, "logoFile");
      throw e;
    }
    if (raw.get("removeLogo") === "on") { await deleteFileByUrl(ctx.business.logoUrl); logoUrl = null; }
    if (raw.get("removeCover") === "on") { await deleteFileByUrl(ctx.business.coverUrl); coverUrl = null; }
    await db
      .update(schema.businesses)
      .set({ tagline: d.tagline, about: d.about, logoUrl, coverUrl, brandColor: d.brandColor.toLowerCase() === "#6d28d9" ? null : d.brandColor, website: d.website, instagram: d.instagram, hoursText: d.hoursText })
      .where(eq(schema.businesses.id, ctx.business.id));
    revalidatePath(`/app/${d.slug}/settings/profile`);
    revalidatePath(`/book/${ctx.business.slug}`, "layout");
    return "Profile saved";
  },
);
