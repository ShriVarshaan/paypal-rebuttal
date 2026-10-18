import type { TransactionContext } from "@rebuttal/core";
import { describe, expect, it } from "vitest";
import { createEasyPostSource, createOfflineEasyPostSource, trackingNumbers } from "./easypost.js";
import type { ConnectorCase } from "./types.js";

function caseWith(codes: string[]): ConnectorCase {
  const ctx: TransactionContext = {
    fetchedAt: "2026-10-20T00:00:00Z",
    capture: null,
    errors: [],
    order: {
      id: "O1",
      status: "COMPLETED",
      createdAt: null,
      items: [],
      shipping: { fullName: "Test Buyer", address: { postal_code: "95131", country_code: "US" } },
      trackingNumbers: codes.map((trackingNumber) => ({ trackingNumber, status: "SHIPPED" })),
    },
  };
  return {
    id: "c1",
    paypalDisputeId: "PP-D-1",
    reason: "MERCHANDISE_OR_SERVICE_NOT_RECEIVED",
    status: "WAITING_FOR_SELLER_RESPONSE",
    disputeState: null,
    stage: "CHARGEBACK",
    channel: null,
    amount: { cents: 8900, currency: "USD" },
    sellerResponseDueAt: null,
    buyerResponseDueAt: null,
    outcomeCode: null,
    disputedTransactions: [],
    messages: [],
    paypalCreatedAt: "2026-10-15T00:00:00Z",
    paypalUpdatedAt: "2026-10-15T00:00:00Z",
    state: "NEW",
    withdrawn: false,
    transactionContext: ctx,
  };
}

describe("EasyPost connector", () => {
  it("only supports cases with tracking numbers", () => {
    const src = createOfflineEasyPostSource();
    expect(src.supports(caseWith([]))).toBe(false);
    expect(src.supports(caseWith(["EZ4000000004", "EZ4000000004"]))).toBe(true);
    expect(trackingNumbers(caseWith(["EZ4000000004", "EZ4000000004"]))).toEqual(["EZ4000000004"]);
  });

  it("turns an EasyPost tracker into proof of fulfillment", async () => {
    const calls: unknown[] = [];
    const fetch = (async (_url: string, init: RequestInit) => {
      calls.push(JSON.parse(String(init.body)));
      return new Response(
        JSON.stringify({
          id: "trk_1",
          tracking_code: "EZ4000000004",
          status: "delivered",
          carrier: "USPS",
          signed_by: "John Tester",
          public_url: "https://track.easypost.com/x",
          tracking_details: [
            { status: "in_transit", message: "In transit", datetime: "2026-10-03T10:00:00Z" },
            {
              status: "delivered",
              message: "Delivered",
              datetime: "2026-10-05T15:00:00Z",
              tracking_location: { city: "SAN JOSE", zip: "95131" },
            },
          ],
        }),
        { status: 200 },
      );
    }) as unknown as typeof globalThis.fetch;
    const src = createEasyPostSource({
      apiKey: "EZTK_test",
      fetch,
      now: () => new Date("2026-10-20T00:00:00Z"),
    });
    const [item] = await src.gather(caseWith(["EZ4000000004"]));
    expect(calls).toEqual([{ tracker: { tracking_code: "EZ4000000004", carrier: "USPS" } }]);
    expect(item).toMatchObject({
      source: "easypost",
      type: "PROOF_OF_FULFILLMENT",
      dedupeKey: "tracker:EZ4000000004",
      data: {
        status: "delivered",
        deliveredAt: "2026-10-05T15:00:00Z",
        signedBy: "John Tester",
        shippingPostalCode: "95131",
      },
    });
  });

  it("offline source maps test codes to their fixed statuses", async () => {
    const items = await createOfflineEasyPostSource().gather(caseWith(["EZ4000000004", "EZ5000000005"]));
    expect(items.map((i) => i.data["status"])).toEqual(["delivered", "return_to_sender"]);
  });
});
