import { redirect } from "next/navigation";
export default async function OffersRedirect({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  redirect(`/app/${slug}/packages`);
}
