import { describe, expect, it } from "vitest";
import { createHttpStoreClient, loadFixtureStore, orderRef } from "./store/client.js";
import { createAccountSource, createDownloadLogSource, createMessagesSource } from "./store-sources.js";
import type { ConnectorCase } from "./types.js";

const NOW = () => new Date("2026-10-20T00:00:00Z");
const store = loadFixtureStore();

function fixtureCase(invoice: string, over: Partial<ConnectorCase> = {}): ConnectorCase {
  return {
    id: "c1",
    paypalDisputeId: `PP-D-${invoice}`,
    reason: "UNAUTHORISED",
    status: "WAITING_FOR_SELLER_RESPONSE",
    disputeState: null,
    stage: "CHARGEBACK",
    channel: null,
    amount: { cents: 850, currency: "USD" },
    sellerResponseDueAt: null,
    buyerResponseDueAt: null,
    outcomeCode: null,
    disputedTransactions: [
      {
        sellerTransactionId: null,
        buyerTransactionId: null,
        grossAmount: null,
        createdAt: null,
        invoiceNumber: invoice,
        buyerName: null,
        items: [],
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

describe("messages connector", () => {
  it("merges store email with the PayPal dispute thread and notes the seller replied", async () => {
    const c = fixtureCase("INV-1001", {
      messages: [
        {
          postedBy: "BUYER",
          postedAt: "2026-10-15T09:12:44.000Z",
          content: "I never received my headphones.",
        },
      ],
    });
    const [item] = await createMessagesSource(store, NOW).gather(c);
    expect(item).toMatchObject({
      source: "messages",
      type: "OTHER",
      dedupeKey: "thread:PP-D-INV-1001",
      data: { kind: "message_thread", sellerReplied: true, firstSellerReplyHours: 3.4, buyerMessageCount: 2 },
    });
    expect((item!.data["messages"] as { channel: string }[]).map((m) => m.channel)).toEqual([
      "email",
      "email",
      "paypal",
    ]);
  });

  it("works from PayPal messages alone when there's no store", async () => {
    const c = fixtureCase("NOPE", { messages: [{ postedBy: "BUYER", postedAt: null, content: "hello" }] });
    const [item] = await createMessagesSource(null, NOW).gather(c);
    expect(item?.data).toMatchObject({ sellerReplied: false, buyerMessageCount: 1 });
    expect(await createMessagesSource(null, NOW).gather(fixtureCase("NOPE"))).toEqual([]);
  });
});

describe("download-log connector", () => {
  it("proves access after purchase from the checkout IP", async () => {
    const [item] = await createDownloadLogSource(store, NOW).gather(fixtureCase("INV-1003"));
    expect(item).toMatchObject({
      type: "PROOF_FOR_SOFTWARE_OR_SERVICE_DELIVERED",
      data: {
        kind: "access_log",
        accessCount: 2,
        accessedAfterPurchase: true,
        ipMatchesCheckout: true,
        firstAccessAt: "2026-10-11T22:49:41.000Z",
      },
    });
  });

  it("ignores physical orders", async () => {
    expect(await createDownloadLogSource(store, NOW).gather(fixtureCase("INV-1001"))).toEqual([]);
  });
});

describe("account connector", () => {
  it("emits buyer history and checkout risk", async () => {
    const items = await createAccountSource(store, NOW).gather(fixtureCase("INV-1003"));
    expect(items.map((i) => i.data["kind"])).toEqual(["buyer_history", "checkout_risk"]);
    expect(items[0]!.data).toMatchObject({ priorOrders: 2, priorDisputes: 0, accountAgeDays: 708 });
    expect(items[1]!.data).toMatchObject({
      avsMatch: true,
      cvvMatch: true,
      ipMatch: true,
      deviceMatch: true,
    });
  });

  it("finds orders by capture id too", async () => {
    const c = fixtureCase("unknown");
    c.disputedTransactions[0]!.sellerTransactionId = "7MC82044LD0067890";
    expect(orderRef(c).captureId).toBe("7MC82044LD0067890");
    expect((await store.findOrder(orderRef(c)))?.id).toBe("ord_1002");
  });
});

describe("HTTP store client", () => {
  it("treats 404 as no record and validates responses", async () => {
    const seen: string[] = [];
    const fetch = (async (url: string) => {
      seen.push(url);
      if (url.includes("lookup"))
        return new Response(JSON.stringify({ id: "o1", placedAt: "2026-10-01T00:00:00Z" }));
      if (url.endsWith("/messages"))
        return new Response(JSON.stringify([{ at: "2026-10-02T00:00:00Z", from: "buyer", text: "hi" }]));
      return new Response("nope", { status: 404 });
    }) as unknown as typeof globalThis.fetch;
    const client = createHttpStoreClient({ baseUrl: "http://store.test/", fetch });
    expect(await client.findOrder({ invoiceNumber: "INV 1" })).toMatchObject({
      id: "o1",
      digital: false,
      items: [],
    });
    expect(await client.messages("o1")).toEqual([
      { at: "2026-10-02T00:00:00Z", from: "buyer", channel: "email", text: "hi" },
    ]);
    expect(await client.customer("x")).toBeNull();
    expect(await client.accessLog("o1")).toEqual([]);
    expect(seen[0]).toBe("http://store.test/api/orders/lookup?invoice=INV+1");
    expect(await client.findOrder({})).toBeNull();
  });
});
