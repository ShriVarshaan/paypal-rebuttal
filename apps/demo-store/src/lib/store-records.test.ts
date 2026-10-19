import { loadFixtureStore } from "@rebuttal/connectors/store/client";
import { createDb } from "@rebuttal/db";
import { seedDemoData } from "@rebuttal/db/seed";
import { createTestDatabase } from "@rebuttal/testkit";
import { afterEach, describe, expect, inject, it } from "vitest";
import { createStoreRecords } from "./store-records";

const drops: Array<() => Promise<void>> = [];

afterEach(async () => {
  await Promise.all(drops.splice(0).map((drop) => drop()));
});

describe("database store records", () => {
  it("matches the existing fixture client for every legacy purchase", async () => {
    const testDb = await createTestDatabase(inject("pgAdminUrl"));
    drops.push(testDb.drop);
    const db = createDb(testDb.url);
    const fixture = loadFixtureStore();
    const records = createStoreRecords(db);

    try {
      await seedDemoData(db, new Date("2026-10-20T12:00:00.000Z"));
      const references = [
        { invoiceNumber: "INV-1001", orderId: "ord_1001", customerId: "cus_201" },
        { captureId: "7MC82044LD0067890", orderId: "ord_1002", customerId: "cus_202" },
        { paypalOrderId: "2RT77001KK550120M", orderId: "ord_1003", customerId: "cus_203" },
      ];

      for (const reference of references) {
        const lookup = {
          invoiceNumber: reference.invoiceNumber,
          captureId: reference.captureId,
          paypalOrderId: reference.paypalOrderId,
        };
        await expect(records.findOrder(lookup)).resolves.toEqual(
          await fixture.findOrder({
            invoiceNumber: reference.invoiceNumber,
            captureId: reference.captureId,
            orderId: reference.paypalOrderId,
          }),
        );
        await expect(records.messages(reference.orderId)).resolves.toEqual(
          await fixture.messages(reference.orderId),
        );
        await expect(records.accessLog(reference.orderId)).resolves.toEqual(
          await fixture.accessLog(reference.orderId),
        );
        await expect(records.customer(reference.customerId)).resolves.toEqual(
          await fixture.customer(reference.customerId),
        );
        await expect(records.refunds(reference.orderId)).resolves.toEqual(
          await fixture.refunds(reference.orderId),
        );
        await expect(records.subscription(reference.orderId)).resolves.toEqual(
          await fixture.subscription(reference.orderId),
        );
      }
    } finally {
      await db.$disconnect();
    }
  });
});
