import { loadFixtureStore } from "./store/client.js";
import { createStorefrontSource, type StorefrontCaptureService } from "./storefront.js";
import type { ConnectorCase } from "./types.js";
import { describe, expect, it } from "vitest";

const store = loadFixtureStore();
const NOW = () => new Date("2026-10-20T12:00:00.000Z");

function fixtureCase(over: Partial<ConnectorCase> = {}): ConnectorCase {
  return {
    id: "case-storefront",
    paypalDisputeId: "PP-storefront",
    reason: "MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED",
    status: "WAITING_FOR_SELLER_RESPONSE",
    disputeState: null,
    stage: "CHARGEBACK",
    channel: null,
    amount: { cents: 6450, currency: "USD" },
    sellerResponseDueAt: null,
    buyerResponseDueAt: null,
    outcomeCode: null,
    disputedTransactions: [
      {
        sellerTransactionId: "7MC82044LD0067890",
        buyerTransactionId: null,
        grossAmount: { cents: 6450, currency: "USD" },
        createdAt: "2026-10-05T10:02:10.000Z",
        invoiceNumber: "INV-1002",
        buyerName: null,
        items: [{ name: "Waxed canvas jacket, size M", quantity: "1" }],
      },
    ],
    messages: [],
    paypalCreatedAt: "2026-10-17T06:05:19.000Z",
    paypalUpdatedAt: "2026-10-17T06:05:19.000Z",
    state: "GATHERING",
    withdrawn: false,
    transactionContext: null,
    ...over,
  };
}

describe("storefront evidence source", () => {
  it("uses the pinned purchase-time snapshot and emits a separate current-listing diff", async () => {
    const capture: StorefrontCaptureService = {
      capture: async () => ({
        status: "captured",
        filePath: "C:/evidence/listing.png",
        sizeBytes: 10,
        capturedAt: NOW().toISOString(),
      }),
    };
    const items = await createStorefrontSource(store, { now: NOW, capture }).gather(fixtureCase());
    const listing = items.find((item) => item.data["kind"] === "listing_snapshot");
    const diff = items.find((item) => item.data["kind"] === "listing_diff");
    expect(items.find((item) => item.data["kind"] === "order")?.data).toMatchObject({
      orderId: "ord_1002",
      exactIdentifierMatch: true,
    });
    expect(listing).toMatchObject({
      filePath: "C:/evidence/listing.png",
      data: {
        snapshotId: "snapshot-product-legacy-jacket-r1",
        revision: 1,
        title: "Waxed canvas jacket, size M",
        orderedAt: "2026-10-05T10:02:10.000Z",
      },
    });
    expect(diff?.data).toMatchObject({
      originalSnapshot: { revision: 1 },
      currentSnapshot: { revision: 2 },
      changedFields: ["title", "description"],
    });
  });

  it("refuses conflicting exact identifiers instead of choosing an approximate order", async () => {
    const items = await createStorefrontSource(store, { now: NOW }).gather(
      fixtureCase({
        disputedTransactions: [{ ...fixtureCase().disputedTransactions[0]!, invoiceNumber: "INV-1001" }],
        transactionContext: {
          fetchedAt: NOW().toISOString(),
          capture: null,
          order: {
            id: "5O190127TN364715T",
            status: "COMPLETED",
            createdAt: "2026-10-02T14:20:31.000Z",
            items: [],
            shipping: null,
            trackingNumbers: [],
          },
          errors: [],
        },
      }),
    );
    expect(items).toHaveLength(1);
    expect(items[0]?.data).toMatchObject({ orderResolved: false });
    expect(items[0]?.data["diagnostic"]).toContain("conflicting");
  });

  it("keeps stable dedupe keys across repeated gather calls", async () => {
    const source = createStorefrontSource(store, { now: NOW });
    const first = await source.gather(fixtureCase());
    const second = await source.gather(fixtureCase());
    expect(second.map((item) => item.dedupeKey)).toEqual(first.map((item) => item.dedupeKey));
  });
});
