import { readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import type { ConnectorCase } from "../types.js";
import {
  AccessEvent,
  StoreCustomer,
  StoreFixture,
  StoreMessage,
  StoreOrder,
  StoreRefund,
  StoreSubscription,
} from "./schema.js";

export interface OrderRef {
  invoiceNumber?: string | null;
  captureId?: string | null;
  orderId?: string | null;
}

/** Read-only access to the seller's store records. */
export interface StoreClient {
  findOrder(ref: OrderRef): Promise<StoreOrder | null>;
  messages(orderId: string): Promise<StoreMessage[]>;
  accessLog(orderId: string): Promise<AccessEvent[]>;
  customer(customerId: string): Promise<StoreCustomer | null>;
  refunds(orderId: string): Promise<StoreRefund[]>;
  subscription(orderId: string): Promise<StoreSubscription | null>;
}

/** How a dispute points at a store order: invoice number, capture id, PayPal order id. */
export function orderRef(c: ConnectorCase): OrderRef {
  const t = c.disputedTransactions[0];
  return {
    invoiceNumber: t?.invoiceNumber ?? null,
    captureId: t?.sellerTransactionId ?? c.transactionContext?.capture?.id ?? null,
    orderId: c.transactionContext?.order?.id ?? null,
  };
}

export function createFixtureStoreClient(fixture: StoreFixture): StoreClient {
  const f = StoreFixture.parse(fixture);
  return {
    async findOrder(ref) {
      return (
        f.orders.find(
          (o) =>
            (ref.invoiceNumber && o.invoiceNumber === ref.invoiceNumber) ||
            (ref.captureId && o.paypalCaptureId === ref.captureId) ||
            (ref.orderId && o.paypalOrderId === ref.orderId),
        ) ?? null
      );
    },
    messages: async (id) => f.messages[id] ?? [],
    accessLog: async (id) => f.accessLogs[id] ?? [],
    customer: async (id) => f.customers.find((c) => c.id === id) ?? null,
    refunds: async (id) => f.refunds[id] ?? [],
    subscription: async (id) => f.subscriptions[id] ?? null,
  };
}

export const FIXTURE_STORE_PATH = join(import.meta.dirname, "../../../../fixtures/store/store.json");

export function loadFixtureStore(path = FIXTURE_STORE_PATH): StoreClient {
  return createFixtureStoreClient(StoreFixture.parse(JSON.parse(readFileSync(path, "utf8"))));
}

export interface HttpStoreOptions {
  baseUrl: string;
  token?: string;
  fetch?: typeof fetch;
}

/** The demo store's REST API (STORE_API.md). 404 means "no such record", not an error. */
export function createHttpStoreClient(opts: HttpStoreOptions): StoreClient {
  const fetchImpl = opts.fetch ?? globalThis.fetch;
  const base = opts.baseUrl.replace(/\/+$/, "");

  async function get<T extends z.ZodType>(path: string, schema: T): Promise<z.infer<T> | null> {
    const res = await fetchImpl(`${base}${path}`, {
      headers: {
        Accept: "application/json",
        ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}),
      },
    });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`Store ${path} failed with ${res.status}`);
    return schema.parse(await res.json());
  }
  const enc = encodeURIComponent;

  return {
    async findOrder(ref) {
      const q = new URLSearchParams();
      if (ref.invoiceNumber) q.set("invoice", ref.invoiceNumber);
      if (ref.captureId) q.set("capture", ref.captureId);
      if (ref.orderId) q.set("paypalOrder", ref.orderId);
      if (![...q.keys()].length) return null;
      return get(`/api/orders/lookup?${q}`, StoreOrder);
    },
    messages: async (id) => (await get(`/api/orders/${enc(id)}/messages`, z.array(StoreMessage))) ?? [],
    accessLog: async (id) => (await get(`/api/orders/${enc(id)}/access-log`, z.array(AccessEvent))) ?? [],
    customer: (id) => get(`/api/customers/${enc(id)}`, StoreCustomer),
    refunds: async (id) => (await get(`/api/orders/${enc(id)}/refunds`, z.array(StoreRefund))) ?? [],
    subscription: (id) => get(`/api/orders/${enc(id)}/subscription`, StoreSubscription),
  };
}
