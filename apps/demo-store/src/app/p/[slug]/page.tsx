import { ListingView, listingStyles } from "@rebuttal/storefront";
import { notFound } from "next/navigation";
import { createCatalog } from "@/lib/catalog";
import { getDb } from "@/lib/db";

export default async function ProductPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const product = await createCatalog(getDb()).product(slug);
  if (!product) notFound();
  return (
    <>
      <style>{listingStyles}</style>
      <ListingView snapshot={product.currentSnapshot} mode="current" />
    </>
  );
}
