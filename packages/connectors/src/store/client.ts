import { readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import type { ConnectorCase } from "../types.js";
import { ListingSnapshot, StoreProductListing } from "@rebuttal/core";
import {
  AccessEvent,
  StoreCustomer,
  StoreFixture,
  StoreMessage,
  StoreOrder,
  StoreRefund,
  StoreShipment,
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
  shipments(orderId: string): Promise<StoreShipment[]>;
  product(id: string): Promise<StoreProductListing | null>;
  listingSnapshot(productId: string, at: string): Promise<ListingSnapshot | null>;
  listingSnapshotById(productId: string, snapshotId: string): Promise<ListingSnapshot | null>;
  searchOrders(input: {
    totalCents: number;
    currency: string;
    placedAt: string;
    sku?: string;
  }): Promise<StoreOrder[]>;
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
    shipments: async (id) => f.shipments[id] ?? [],
    async product(id) {
      const product = f.products.find((value) => value.id === id || value.slug === id || value.sku === id);
      if (!product) return null;
      const currentSnapshot = [...product.snapshots].sort(compareSnapshots)[0]!;
      return StoreProductListing.parse({ ...product, currentSnapshot });
    },
    async listingSnapshot(productId, at) {
      const instant = Date.parse(at);
      if (!Number.isFinite(instant)) throw new Error(`Invalid snapshot time: ${at}`);
      const product = f.products.find(
        (value) => value.id === productId || value.slug === productId || value.sku === productId,
      );
      if (!product) return null;
      return (
        [...product.snapshots]
          .filter((snapshot) => Date.parse(snapshot.capturedAt) <= instant)
          .sort(compareSnapshots)[0] ?? null
      );
    },
    async listingSnapshotById(productId, snapshotId) {
      const product = f.products.find(
        (value) => value.id === productId || value.slug === productId || value.sku === productId,
      );
      return product?.snapshots.find((snapshot) => snapshot.id === snapshotId) ?? null;
    },
    async searchOrders(input) {
      return f.orders.filter(
        (order) =>
          order.totalCents === input.totalCents &&
          order.currency?.toUpperCase() === input.currency.toUpperCase() &&
          Math.abs(Date.parse(order.placedAt) - Date.parse(input.placedAt)) <= 5 * 60_000 &&
          (!input.sku || order.items.some((item) => item.sku === input.sku)),
      );
    },
  };
}

function compareSnapshots(left: ListingSnapshot, right: ListingSnapshot): number {
  return Date.parse(right.capturedAt) - Date.parse(left.capturedAt) || right.revision - left.revision;
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
    shipments: async (id) => (await get(`/api/orders/${enc(id)}/shipments`, z.array(StoreShipment))) ?? [],
    product: (id) => get(`/api/products/${enc(id)}`, StoreProductListing),
    listingSnapshot: (id, at) =>
      get(`/api/products/${enc(id)}/snapshots?at=${encodeURIComponent(at)}`, ListingSnapshot),
    listingSnapshotById: (id, snapshotId) =>
      get(`/api/products/${enc(id)}/snapshots/${enc(snapshotId)}`, ListingSnapshot),
    searchOrders: async (input) => {
      const query = new URLSearchParams({
        totalCents: String(input.totalCents),
        currency: input.currency,
        placedAt: input.placedAt,
      });
      if (input.sku) query.set("sku", input.sku);
      return (await get(`/api/orders/search?${query}`, z.array(StoreOrder))) ?? [];
    },
  };
}
