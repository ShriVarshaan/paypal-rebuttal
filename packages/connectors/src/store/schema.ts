import { z } from "zod";
import { ListingSnapshot, StoreProductListing } from "@rebuttal/core";

/**
 * The seller's own records, as the demo store (C, apps/demo-store) serves them. These
 * schemas are the contract between the store API and the connectors; see STORE_API.md.
 */
export const StoreOrder = z.looseObject({
  id: z.string(),
  invoiceNumber: z.string().nullish(),
  paypalCaptureId: z.string().nullish(),
  paypalOrderId: z.string().nullish(),
  customerId: z.string().nullish(),
  placedAt: z.string(),
  digital: z.boolean().default(false),
  totalCents: z.number().int().nullish(),
  currency: z.string().nullish(),
  items: z
    .array(
      z.looseObject({
        name: z.string(),
        sku: z.string().nullish(),
        digital: z.boolean().nullish(),
        productId: z.string().nullish(),
        listingSnapshotId: z.string().nullish(),
        quantity: z.number().int().positive().nullish(),
        unitPriceCents: z.number().int().nonnegative().nullish(),
      }),
    )
    .default([]),
  checkout: z
    .looseObject({
      ip: z.string().nullish(),
      deviceId: z.string().nullish(),
      /** AVS result code from the card network (Y/X/D/M/F = address match). */
      avs: z.string().nullish(),
      /** CVV result code (M = match). */
      cvv: z.string().nullish(),
    })
    .nullish(),
});
export type StoreOrder = z.infer<typeof StoreOrder>;

export const StoreMessage = z.looseObject({
  at: z.string(),
  from: z.enum(["buyer", "seller"]),
  channel: z.string().default("email"),
  text: z.string(),
});
export type StoreMessage = z.infer<typeof StoreMessage>;

export const AccessEvent = z.looseObject({
  at: z.string(),
  ip: z.string().nullish(),
  action: z.string().default("download"),
});
export type AccessEvent = z.infer<typeof AccessEvent>;

export const StoreCustomer = z.looseObject({
  id: z.string(),
  createdAt: z.string().nullish(),
  /** Completed orders before this one that were never disputed. */
  priorOrders: z.number().int().nonnegative().default(0),
  priorDisputes: z.number().int().nonnegative().default(0),
  knownIps: z.array(z.string()).default([]),
  knownDevices: z.array(z.string()).default([]),
});
export type StoreCustomer = z.infer<typeof StoreCustomer>;

export const StoreRefund = z.looseObject({
  id: z.string(),
  amountCents: z.number().int(),
  refundedAt: z.string(),
});
export type StoreRefund = z.infer<typeof StoreRefund>;

export const StoreSubscription = z.looseObject({
  id: z.string(),
  status: z.string(),
  chargedAt: z.string().nullish(),
  cancelledAt: z.string().nullish(),
  termsUrl: z.string().nullish(),
});
export type StoreSubscription = z.infer<typeof StoreSubscription>;

export const StoreShipment = z.looseObject({
  id: z.string(),
  orderId: z.string(),
  carrier: z.string(),
  trackingNumber: z.string(),
  status: z.string(),
  address: z.record(z.string(), z.unknown()),
  history: z.array(z.record(z.string(), z.unknown())),
  shippedAt: z.string().nullish(),
  deliveredAt: z.string().nullish(),
});
export type StoreShipment = z.infer<typeof StoreShipment>;

export const StoreFixtureProduct = StoreProductListing.omit({ currentSnapshot: true }).extend({
  snapshots: z.array(ListingSnapshot).min(1),
});
export type StoreFixtureProduct = z.infer<typeof StoreFixtureProduct>;

/** fixtures/store/store.json: the same records, keyed by order id where they belong to one. */
export const StoreFixture = z.object({
  orders: z.array(StoreOrder).default([]),
  messages: z.record(z.string(), z.array(StoreMessage)).default({}),
  accessLogs: z.record(z.string(), z.array(AccessEvent)).default({}),
  customers: z.array(StoreCustomer).default([]),
  refunds: z.record(z.string(), z.array(StoreRefund)).default({}),
  subscriptions: z.record(z.string(), StoreSubscription).default({}),
  shipments: z.record(z.string(), z.array(StoreShipment)).default({}),
  products: z.array(StoreFixtureProduct).default([]),
});
export type StoreFixture = z.infer<typeof StoreFixture>;
