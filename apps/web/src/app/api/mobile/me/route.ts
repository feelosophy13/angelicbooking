import { NextResponse } from "next/server";
import { mobileContext } from "@/lib/mobile-auth";

export async function GET(req: Request) {
  const c = await mobileContext(req, null);
  if ("error" in c) return c.error;
  return NextResponse.json({ user: { id: c.session.user.id, name: c.session.user.name, email: c.session.user.email }, businesses: c.memberships });
}
