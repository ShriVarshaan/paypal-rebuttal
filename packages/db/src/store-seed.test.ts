import { createTestDatabase } from "@rebuttal/testkit";
import { afterEach, describe, expect, inject, it } from "vitest";
import { createDb } from "./index.js";
import { seedDemoData } from "./seed.js";

const drops: Array<() => Promise<void>> = [];

afterEach(async () => {
  await Promise.all(drops.splice(0).map((drop) => drop()));
});

describe("demo store catalog seed", () => {
  it("preserves fixture purchases and models edited, unchanged, and missing listing history", async () => {
    const testDb = await createTestDatabase(inject("pgAdminUrl"));
    drops.push(testDb.drop);
    const db = createDb(testDb.url);

    try {
      await seedDemoData(db, new Date("2026-10-20T12:00:00.000Z"));

      const featured = await db.storeProduct.findMany({
        where: { featured: true },
        include: { snapshots: true },
      });
      expect(featured).toHaveLength(10);
      const kinds = featured.map((product) => {
        const attributes = product.snapshots[0]?.attributes as { digital?: unknown } | undefined;
        return attributes?.digital === true ? "digital" : "physical";
      });
      expect(kinds.filter((kind) => kind === "physical")).toHaveLength(7);
      expect(kinds.filter((kind) => kind === "digital")).toHaveLength(3);

      const fixtures = await db.storeOrder.findMany({
        where: { id: { in: ["ord_1001", "ord_1002", "ord_1003"] } },
        orderBy: { id: "asc" },
        include: { items: true },
      });
      expect(
        fixtures.map((order) => ({
          id: order.id,
          invoice: order.invoiceNumber,
          capture: order.paypalCaptureId,
          paypalOrder: order.paypalOrderId,
          totalCents: order.totalCents,
          item: order.items[0]?.name,
          sku: order.items[0]?.sku,
          ip: order.checkoutIp,
          device: order.checkoutDeviceId,
          avs: order.avs,
          cvv: order.cvv,
        })),
      ).toEqual([
        {
          id: "ord_1001",
          invoice: "INV-1001",
          capture: "3VK13355SM0012345",
          paypalOrder: "5O190127TN364715T",
          totalCents: 8900,
          item: "Wireless headphones",
          sku: "SKU-HEADPHONES-01",
          ip: "203.0.113.24",
          device: "dev_a71",
          avs: "Y",
          cvv: "M",
        },
        {
          id: "ord_1002",
          invoice: "INV-1002",
          capture: "7MC82044LD0067890",
          paypalOrder: "8XK40513CD118802B",
          totalCents: 6450,
          item: "Waxed canvas jacket, size M",
          sku: "SKU-JACKET-M",
          ip: "198.51.100.7",
          device: "dev_b02",
          avs: "Y",
          cvv: "M",
        },
        {
          id: "ord_1003",
          invoice: "INV-1003",
          capture: "9PL33012QA0044556",
          paypalOrder: "2RT77001KK550120M",
          totalCents: 850,
          item: "Digital recipe e-book",
          sku: "SKU-EBOOK-07",
          ip: "192.0.2.55",
          device: "dev_c19",
          avs: "Y",
          cvv: "M",
        },
      ]);

      const purchaseItems = await db.storeOrderItem.findMany({
        include: { order: true, product: { include: { snapshots: true } }, listingSnapshot: true },
      });
      const editedAfterPurchase = purchaseItems.filter(
        (item) =>
          item.listingSnapshot &&
          item.product.snapshots.some(
            (snapshot) =>
              snapshot.capturedAt > item.order.placedAt && snapshot.revision > item.listingSnapshot!.revision,
          ),
      );
      expect(editedAfterPurchase.map((item) => item.orderId).sort()).toEqual([
        "demo-order-bowl-01",
        "ord_1002",
      ]);

      const unchanged = purchaseItems.find((item) => item.orderId === "ord_1001");
      expect(unchanged?.listingSnapshotId).not.toBeNull();
      expect(unchanged?.product.snapshots).toHaveLength(1);

      const missing = purchaseItems.find((item) => item.orderId === "ord_1003");
      expect(missing?.listingSnapshotId).toBeNull();
      expect(missing?.product.snapshots).toHaveLength(0);

      const thread = await db.storeMessage.findMany({
        where: { thread: { orderId: "ord_1001" } },
        orderBy: { sentAt: "asc" },
      });
      expect(thread.map((message) => message.text)).toEqual([
        "Hi, my headphones haven't shown up. Can you check?",
        "Sorry to hear that! USPS tracking EZ4000000004 shows it was delivered on Oct 5 and signed for. Could you check with neighbours or your building's mail room?",
      ]);
      await expect(db.storeDownloadEvent.count({ where: { orderId: "ord_1003" } })).resolves.toBe(2);
    } finally {
      await db.$disconnect();
    }
  });
});
