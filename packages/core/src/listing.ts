import { z } from "zod";
import { IsoDateTime } from "./records.js";

/** One immutable, bundled asset referenced by a historical listing snapshot. */
export const ListingAsset = z.object({
  id: z.string().min(1),
  role: z.string().min(1),
  src: z.string().min(1),
  alt: z.string().min(1),
});
export type ListingAsset = z.infer<typeof ListingAsset>;

/**
 * Complete renderer input for one published version of a product listing. A historical
 * page receives only this value, so current product fields cannot leak into old evidence.
 */
export const ListingSnapshot = z.object({
  id: z.string().min(1),
  productId: z.string().min(1),
  title: z.string().min(1),
  description: z.string(),
  priceCents: z.number().int().nonnegative(),
  currency: z.string().length(3),
  attributes: z.record(z.string(), z.unknown()),
  assets: z.array(ListingAsset),
  capturedAt: IsoDateTime,
  revision: z.number().int().positive(),
  rendererVersion: z.string().min(1),
});
export type ListingSnapshot = z.infer<typeof ListingSnapshot>;

/** Public product metadata plus the exact immutable snapshot rendered as its current page. */
export const StoreProductListing = z.object({
  id: z.string().min(1),
  slug: z.string().min(1),
  sku: z.string().min(1),
  active: z.boolean(),
  featured: z.boolean(),
  currentSnapshot: ListingSnapshot,
});
export type StoreProductListing = z.infer<typeof StoreProductListing>;
