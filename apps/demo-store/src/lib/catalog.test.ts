import { createDb } from "@rebuttal/db";
import { seedDemoData } from "@rebuttal/db/seed";
import { createTestDatabase } from "@rebuttal/testkit";
import { afterEach, describe, expect, inject, it } from "vitest";
import { createCatalog } from "./catalog";

const drops: Array<() => Promise<void>> = [];

afterEach(async () => {
  await Promise.all(drops.splice(0).map((drop) => drop()));
});

describe("immutable catalog", () => {
  it("keeps purchase-time history while publishing a later revision transactionally", async () => {
    const testDb = await createTestDatabase(inject("pgAdminUrl"));
    drops.push(testDb.drop);
    const db = createDb(testDb.url);
    try {
      await seedDemoData(db, new Date("2026-10-20T12:00:00.000Z"));
      const catalog = createCatalog(db);
      const beforeEdit = await catalog.snapshotAsOf(
        "product-speckled-bowl",
        new Date("2026-09-15T00:00:00.000Z"),
      );
      const pinnedBefore = await db.storeOrderItem.findUniqueOrThrow({
        where: { id: "item-demo-order-bowl-01" },
      });

      const published = await catalog.publish("product-speckled-bowl", {
        title: "Speckled serving bowl — studio edition",
        description: "A new description that must not alter old evidence.",
        priceCents: 8200,
        currency: "USD",
        attributes: { category: "ceramics", edition: "studio" },
        assets: [
          {
            id: "catalog-v1/bowl-r3/hero",
            role: "hero",
            src: "/catalog/v1/speckled-serving-bowl-r2.webp",
            alt: "Studio bowl",
          },
        ],
        capturedAt: new Date("2026-10-10T09:00:00.000Z"),
      });

      const pinnedAfter = await db.storeOrderItem.findUniqueOrThrow({
        where: { id: "item-demo-order-bowl-01" },
      });
      expect(beforeEdit?.revision).toBe(1);
      expect(
        (await catalog.snapshotAsOf("product-speckled-bowl", new Date("2026-09-15T00:00:00.000Z")))?.title,
      ).toBe(beforeEdit?.title);
      expect(published.currentSnapshot).toMatchObject({
        revision: 3,
        title: "Speckled serving bowl — studio edition",
      });
      expect(
        (await catalog.snapshotAsOf("product-speckled-bowl", new Date("2026-10-10T09:00:00.000Z")))?.revision,
      ).toBe(3);
      expect(pinnedAfter.listingSnapshotId).toBe(pinnedBefore.listingSnapshotId);
    } finally {
      await db.$disconnect();
    }
  });

  it("creates a product and its first snapshot atomically", async () => {
    const testDb = await createTestDatabase(inject("pgAdminUrl"));
    drops.push(testDb.drop);
    const db = createDb(testDb.url);
    try {
      const created = await createCatalog(db).create(
        {
          id: "product-new",
          slug: "new-product",
          sku: "NEW-1",
          title: "New product",
          description: "Published once.",
          priceCents: 1200,
          currency: "usd",
          attributes: {},
          assets: [],
          active: true,
          featured: false,
        },
        new Date("2026-10-20T12:00:00.000Z"),
      );
      expect(created.currentSnapshot).toMatchObject({ revision: 1, currency: "USD" });
      expect(await db.listingSnapshot.count({ where: { productId: "product-new" } })).toBe(1);
    } finally {
      await db.$disconnect();
    }
  });
});
