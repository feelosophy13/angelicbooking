"use server";
import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { VIEW_AS_COOKIE, viewAsEnabled } from "@/lib/dev-view-as";

/** Dev only: pick the role to view the app as ("" goes back to your real role). */
export async function setViewAs(formData: FormData) {
  if (!viewAsEnabled()) throw new Error("Not available.");
  const role = String(formData.get("role") ?? "");
  const jar = await cookies();
  if (role && /^[a-z0-9_-]{1,40}(:[A-Za-z0-9_-]{1,64})?$/.test(role)) jar.set(VIEW_AS_COOKIE, role, { path: "/", sameSite: "lax", maxAge: 60 * 60 * 24 * 7 });
  else jar.delete(VIEW_AS_COOKIE);
  revalidatePath("/app", "layout");
}
