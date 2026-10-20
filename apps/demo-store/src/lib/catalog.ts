import { ListingSnapshot, StoreProductListing } from "@rebuttal/core";
import type { Db, Prisma } from "@rebuttal/db";
import { z } from "zod";

export const PublishListingInput = z.object({
  title: z.string().trim().min(1),
  description: z.string(),
  priceCents: z.number().int().nonnegative(),
  currency: z
    .string()
    .length(3)
    .transform((value) => value.toUpperCase()),
  attributes: z.record(z.string(), z.unknown()).default({}),
  assets: z.array(
    z.object({
      id: z.string().min(1),
      role: z.string().min(1),
      src: z.string().min(1),
      alt: z.string().min(1),
    }),
  ),
  capturedAt: z.coerce.date().optional(),
});

export const CreateProductInput = PublishListingInput.extend({
  id: z.string().min(1).optional(),
  slug: z.string().trim().min(1),
  sku: z.string().trim().min(1),
  active: z.boolean().default(true),
  featured: z.boolean().default(false),
});

export type PublishListingInput = z.infer<typeof PublishListingInput>;
export type CreateProductInput = z.infer<typeof CreateProductInput>;

type SnapshotRow = {
  id: string;
  productId: string;
  title: string;
  description: string;
  priceCents: number;
  currency: string;
  attributes: unknown;
  assets: unknown;
  capturedAt: Date;
  revision: number;
  rendererVersion: string;
};

function toSnapshot(row: SnapshotRow) {
  return ListingSnapshot.parse({
    ...row,
    capturedAt: row.capturedAt.toISOString(),
  });
}

function toProduct(row: {
  id: string;
  slug: string;
  sku: string;
  active: boolean;
  featured: boolean;
  snapshots: SnapshotRow[];
}) {
  const currentSnapshot = row.snapshots[0];
  if (!currentSnapshot) return null;
  return StoreProductListing.parse({
    id: row.id,
    slug: row.slug,
    sku: row.sku,
    active: row.active,
    featured: row.featured,
    currentSnapshot: toSnapshot(currentSnapshot),
  });
}

const currentSnapshot = {
  orderBy: [{ capturedAt: "desc" as const }, { revision: "desc" as const }],
  take: 1,
};

export function createCatalog(db: Db) {
  return {
    async product(idOrSlug: string) {
      const row = await db.storeProduct.findFirst({
        where: { OR: [{ id: idOrSlug }, { slug: idOrSlug }, { sku: idOrSlug }] },
        include: { snapshots: currentSnapshot },
      });
      return row ? toProduct(row) : null;
    },

    async snapshotAsOf(productId: string, at: Date) {
      const product = await db.storeProduct.findFirst({
        where: { OR: [{ id: productId }, { slug: productId }, { sku: productId }] },
        select: { id: true },
      });
      if (!product) return null;
      const row = await db.listingSnapshot.findFirst({
        where: { productId: product.id, capturedAt: { lte: at } },
        orderBy: [{ capturedAt: "desc" }, { revision: "desc" }],
      });
      return row ? toSnapshot(row) : null;
    },

    async snapshot(productId: string, snapshotId: string) {
      const product = await db.storeProduct.findFirst({
        where: { OR: [{ id: productId }, { slug: productId }, { sku: productId }] },
        select: { id: true },
      });
      if (!product) return null;
      const row = await db.listingSnapshot.findFirst({ where: { id: snapshotId, productId: product.id } });
      return row ? toSnapshot(row) : null;
    },

    async create(inputValue: CreateProductInput, now = new Date()) {
      const input = CreateProductInput.parse(inputValue);
      return db.$transaction(
        async (tx) => {
          const product = await tx.storeProduct.create({
            data: {
              ...(input.id ? { id: input.id } : {}),
              slug: input.slug,
              sku: input.sku,
              active: input.active,
              featured: input.featured,
            },
          });
          const capturedAt = input.capturedAt ?? now;
          await tx.listingSnapshot.create({
            data: {
              productId: product.id,
              title: input.title,
              description: input.description,
              priceCents: input.priceCents,
              currency: input.currency,
              attributes: input.attributes as Prisma.InputJsonValue,
              assets: input.assets as Prisma.InputJsonValue,
              capturedAt,
              revision: 1,
              rendererVersion: "storefront-v1",
            },
          });
          const row = await tx.storeProduct.findUniqueOrThrow({
            where: { id: product.id },
            include: { snapshots: currentSnapshot },
          });
          return toProduct(row)!;
        },
        { isolationLevel: "Serializable" },
      );
    },

    async publish(idOrSlug: string, inputValue: PublishListingInput, now = new Date()) {
      const input = PublishListingInput.parse(inputValue);
      return db.$transaction(
        async (tx) => {
          const product = await tx.storeProduct.findFirstOrThrow({
            where: { OR: [{ id: idOrSlug }, { slug: idOrSlug }] },
          });
          const aggregate = await tx.listingSnapshot.aggregate({
            where: { productId: product.id },
            _max: { revision: true },
          });
          const capturedAt = input.capturedAt ?? now;
          await tx.listingSnapshot.create({
            data: {
              productId: product.id,
              title: input.title,
              description: input.description,
              priceCents: input.priceCents,
              currency: input.currency,
              attributes: input.attributes as Prisma.InputJsonValue,
              assets: input.assets as Prisma.InputJsonValue,
              capturedAt,
              revision: (aggregate._max.revision ?? 0) + 1,
              rendererVersion: "storefront-v1",
            },
          });
          const row = await tx.storeProduct.findUniqueOrThrow({
            where: { id: product.id },
            include: { snapshots: currentSnapshot },
          });
          return toProduct(row)!;
        },
        { isolationLevel: "Serializable" },
      );
    },
  };
}

export type Catalog = ReturnType<typeof createCatalog>;
