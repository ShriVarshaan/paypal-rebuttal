import { createHttpStoreClient, loadFixtureStore } from "@rebuttal/connectors/store/client";
import { createDb } from "@rebuttal/db";
import { seedDemoData } from "@rebuttal/db/seed";
import { createTestDatabase } from "@rebuttal/testkit";
import { afterEach, describe, expect, inject, it, vi } from "vitest";
import { GET as getCustomer } from "@/app/api/customers/[id]/route";
import { GET as getAccessLog } from "@/app/api/orders/[id]/access-log/route";
import { GET as getMessages } from "@/app/api/orders/[id]/messages/route";
import { GET as getRefunds } from "@/app/api/orders/[id]/refunds/route";
import { GET as getSubscription } from "@/app/api/orders/[id]/subscription/route";
import { GET as lookupOrder } from "@/app/api/orders/lookup/route";

const drops: Array<() => Promise<void>> = [];

afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(drops.splice(0).map((drop) => drop()));
});

const params = (id: string) => ({ params: Promise.resolve({ id }) });

const routeFetch: typeof fetch = async (input, init) => {
  const request = new Request(input, init);
  const url = new URL(request.url);

  if (url.pathname === "/api/orders/lookup") return lookupOrder(request);

  const customer = url.pathname.match(/^\/api\/customers\/([^/]+)$/);
  if (customer) return getCustomer(request, params(decodeURIComponent(customer[1]!)));

  const order = url.pathname.match(/^\/api\/orders\/([^/]+)\/(messages|access-log|refunds|subscription)$/);
  if (order) {
    const context = params(decodeURIComponent(order[1]!));
    switch (order[2]) {
      case "messages":
        return getMessages(request, context);
      case "access-log":
        return getAccessLog(request, context);
      case "refunds":
        return getRefunds(request, context);
      case "subscription":
        return getSubscription(request, context);
    }
  }

  return new Response(null, { status: 404 });
};

describe("store HTTP contract", () => {
  it("matches the fixture client for every legacy purchase", async () => {
    const testDb = await createTestDatabase(inject("pgAdminUrl"));
    drops.push(testDb.drop);
    vi.stubEnv("DATABASE_URL", testDb.url);
    vi.stubEnv("STORE_API_TOKEN", "contract-secret");

    const db = createDb(testDb.url);
    try {
      await seedDemoData(db, new Date("2026-10-20T12:00:00.000Z"));
    } finally {
      await db.$disconnect();
    }

    const fixture = loadFixtureStore();
    const http = createHttpStoreClient({
      baseUrl: "http://store.test",
      token: "contract-secret",
      fetch: routeFetch,
    });
    const references = [
      { invoiceNumber: "INV-1001", orderId: "ord_1001", customerId: "cus_201" },
      { captureId: "7MC82044LD0067890", orderId: "ord_1002", customerId: "cus_202" },
      { orderId: "2RT77001KK550120M", storeOrderId: "ord_1003", customerId: "cus_203" },
    ];

    for (const reference of references) {
      await expect(http.findOrder(reference)).resolves.toEqual(await fixture.findOrder(reference));
      const storeOrderId = reference.storeOrderId ?? reference.orderId;
      await expect(http.messages(storeOrderId)).resolves.toEqual(await fixture.messages(storeOrderId));
      await expect(http.accessLog(storeOrderId)).resolves.toEqual(await fixture.accessLog(storeOrderId));
      await expect(http.customer(reference.customerId)).resolves.toEqual(
        await fixture.customer(reference.customerId),
      );
      await expect(http.refunds(storeOrderId)).resolves.toEqual(await fixture.refunds(storeOrderId));
      await expect(http.subscription(storeOrderId)).resolves.toEqual(
        await fixture.subscription(storeOrderId),
      );
    }

    await expect(http.findOrder({})).resolves.toBeNull();
    await expect(http.customer("missing-customer")).resolves.toBeNull();
    await expect(http.messages("missing-order")).resolves.toEqual([]);
  });
});
