import { createTestDatabase } from "@rebuttal/testkit";
import { afterEach, describe, expect, inject, it } from "vitest";
import { createDb } from "./index.js";
import { DEMO_SEED_CASE_IDS, seedDemoData } from "./seed.js";

const drops: Array<() => Promise<void>> = [];

afterEach(async () => {
  await Promise.all(drops.splice(0).map((drop) => drop()));
});

describe("demo database seed", () => {
  it("is idempotent, preserves user data, and computes decisions without actions", async () => {
    const testDb = await createTestDatabase(inject("pgAdminUrl"));
    drops.push(testDb.drop);
    const db = createDb(testDb.url);
    const firstClock = new Date("2026-10-20T12:00:00.000Z");
    const secondClock = new Date("2026-10-21T12:00:00.000Z");
    const policyUpdatedAt = new Date("2026-10-19T06:00:00.000Z");
    const userPolicy = { autonomy: { enabled: false, maxAmountCents: 7777 } };

    try {
      await db.policy.create({
        data: {
          id: "default",
          merchantId: "default",
          config: userPolicy,
          updatedBy: "merchant-owner",
          updatedAt: policyUpdatedAt,
        },
      });
      await db.case.create({
        data: {
          id: "user-case",
          paypalDisputeId: "PP-D-USER-CASE",
          reason: "OTHER",
          status: "WAITING_FOR_SELLER_RESPONSE",
          stage: "INQUIRY",
          amountCents: 1000,
          currency: "USD",
          disputedTransactions: [],
          messages: [],
          raw: { source: "user" },
          paypalCreatedAt: policyUpdatedAt,
          paypalUpdatedAt: policyUpdatedAt,
          createdAt: policyUpdatedAt,
          updatedAt: policyUpdatedAt,
        },
      });

      const first = await seedDemoData(db, firstClock);
      const beforeRerun = await db.case.findMany({
        where: { id: { in: [...DEMO_SEED_CASE_IDS] } },
        orderBy: { id: "asc" },
        include: { evidence: { orderBy: { id: "asc" } }, decisions: { orderBy: { id: "asc" } } },
      });
      const second = await seedDemoData(db, secondClock);
      const afterRerun = await db.case.findMany({
        where: { id: { in: [...DEMO_SEED_CASE_IDS] } },
        orderBy: { id: "asc" },
        include: { evidence: { orderBy: { id: "asc" } }, decisions: { orderBy: { id: "asc" } } },
      });

      expect(first).toMatchObject({
        merchantCreated: false,
        policyCreated: false,
        casesAdded: 5,
        decisionsAdded: 4,
        storeProductsAdded: 13,
        storeOrdersAdded: 4,
      });
      expect(first.evidenceAdded).toBeGreaterThan(5);
      expect(second).toEqual({
        merchantCreated: false,
        policyCreated: false,
        casesAdded: 0,
        evidenceAdded: 0,
        decisionsAdded: 0,
        storeProductsAdded: 0,
        storeSnapshotsAdded: 0,
        storeCustomersAdded: 0,
        storeOrdersAdded: 0,
        storeOrderItemsAdded: 0,
        storeShipmentsAdded: 0,
        storeThreadsAdded: 0,
        storeMessagesAdded: 0,
        storeDownloadsAdded: 0,
      });
      expect(afterRerun).toEqual(beforeRerun);
      expect(new Set(beforeRerun.map((row) => row.state))).toEqual(
        new Set(["GATHERING", "AWAITING_APPROVAL", "WON", "LOST"]),
      );
      expect(beforeRerun.flatMap((row) => row.decisions)).toHaveLength(4);
      expect(
        beforeRerun
          .flatMap((row) => row.decisions)
          .every(
            (decision) =>
              decision.modelVersion?.startsWith("engine-v1/") &&
              typeof decision.analysis === "object" &&
              decision.analysis !== null,
          ),
      ).toBe(true);

      await expect(db.action.count()).resolves.toBe(0);
      await expect(db.case.findUnique({ where: { id: "user-case" } })).resolves.toMatchObject({
        paypalDisputeId: "PP-D-USER-CASE",
        raw: { source: "user" },
      });
      await expect(db.policy.findUniqueOrThrow({ where: { id: "default" } })).resolves.toMatchObject({
        config: userPolicy,
        updatedBy: "merchant-owner",
        updatedAt: policyUpdatedAt,
      });
    } finally {
      await db.$disconnect();
    }
  });
});
