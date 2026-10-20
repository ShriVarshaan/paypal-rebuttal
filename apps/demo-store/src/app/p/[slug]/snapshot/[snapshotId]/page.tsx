import { ListingView, listingStyles } from "@rebuttal/storefront";
import { notFound } from "next/navigation";
import { createCatalog } from "@/lib/catalog";
import { getDb } from "@/lib/db";

export default async function HistoricalListingPage({
  params,
}: {
  params: Promise<{ slug: string; snapshotId: string }>;
}) {
  const { slug, snapshotId } = await params;
  const snapshot = await createCatalog(getDb()).snapshot(slug, snapshotId);
  if (!snapshot) notFound();
  return (
    <>
      <style>{listingStyles}</style>
      <ListingView snapshot={snapshot} mode="historical" />
    </>
  );
}
