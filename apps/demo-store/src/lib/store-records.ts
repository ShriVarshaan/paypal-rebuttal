import {
  AccessEvent,
  StoreCustomer,
  StoreMessage,
  StoreOrder,
  StoreRefund,
  StoreShipment,
  StoreSubscription,
  type AccessEvent as AccessEventValue,
  type StoreCustomer as StoreCustomerValue,
  type StoreMessage as StoreMessageValue,
  type StoreOrder as StoreOrderValue,
  type StoreRefund as StoreRefundValue,
  type StoreShipment as StoreShipmentValue,
  type StoreSubscription as StoreSubscriptionValue,
} from "@rebuttal/connectors/store/schema";
import type { Db, Prisma } from "@rebuttal/db";

export interface OrderReference {
  invoiceNumber?: string;
  captureId?: string;
  paypalOrderId?: string;
}

const iso = (date: Date) => date.toISOString();

export function createStoreRecords(db: Db) {
  const orderShape = {
    items: { orderBy: { createdAt: "asc" as const } },
  };

  type OrderRow = Prisma.StoreOrderGetPayload<{ include: { items: true } }>;

  const toOrder = (row: OrderRow | null): StoreOrderValue | null => {
    if (!row) return null;
    return StoreOrder.parse({
      id: row.id,
      invoiceNumber: row.invoiceNumber,
      paypalCaptureId: row.paypalCaptureId,
      paypalOrderId: row.paypalOrderId,
      customerId: row.customerId,
      placedAt: iso(row.placedAt),
      digital: row.digital,
      totalCents: row.totalCents,
      currency: row.currency,
      items: row.items.map((item) => ({
        name: item.name,
        sku: item.sku,
        digital: item.digital,
        productId: item.productId,
        listingSnapshotId: item.listingSnapshotId,
        quantity: item.quantity,
        unitPriceCents: item.unitPriceCents,
      })),
      checkout: {
        ip: row.checkoutIp,
        deviceId: row.checkoutDeviceId,
        avs: row.avs,
        cvv: row.cvv,
      },
    });
  };

  return {
    async findOrder(reference: OrderReference): Promise<StoreOrderValue | null> {
      const terms = [
        reference.invoiceNumber ? { invoiceNumber: reference.invoiceNumber } : null,
        reference.captureId ? { paypalCaptureId: reference.captureId } : null,
        reference.paypalOrderId ? { paypalOrderId: reference.paypalOrderId } : null,
      ].filter((term): term is NonNullable<typeof term> => term !== null);
      if (!terms.length) return null;
      const row = await db.storeOrder.findFirst({ where: { OR: terms }, include: orderShape });
      return toOrder(row);
    },

    async searchOrders(input: { totalCents: number; currency: string; placedAt: string; sku?: string }) {
      const rows = await db.storeOrder.findMany({ include: orderShape });
      return rows
        .filter(
          (row) =>
            row.totalCents === input.totalCents &&
            row.currency.toUpperCase() === input.currency.toUpperCase() &&
            Math.abs(row.placedAt.getTime() - Date.parse(input.placedAt)) <= 5 * 60_000 &&
            (!input.sku || row.items.some((item) => item.sku === input.sku)),
        )
        .map(toOrder)
        .filter((row): row is StoreOrderValue => row !== null);
    },

    async orderExists(id: string): Promise<boolean> {
      return (await db.storeOrder.count({ where: { id } })) > 0;
    },

    async messages(id: string): Promise<StoreMessageValue[]> {
      const rows = await db.storeMessage.findMany({
        where: { thread: { orderId: id } },
        orderBy: [{ sentAt: "asc" }, { id: "asc" }],
        include: { thread: { select: { channel: true } } },
      });
      return rows.map((row) =>
        StoreMessage.parse({
          at: iso(row.sentAt),
          from: row.sender,
          channel: row.thread.channel,
          text: row.text,
        }),
      );
    },

    async accessLog(id: string): Promise<AccessEventValue[]> {
      const rows = await db.storeDownloadEvent.findMany({
        where: { orderId: id },
        orderBy: [{ occurredAt: "asc" }, { id: "asc" }],
      });
      return rows.map((row) =>
        AccessEvent.parse({ at: iso(row.occurredAt), ip: row.ip, action: row.action }),
      );
    },

    async customer(id: string): Promise<StoreCustomerValue | null> {
      const row = await db.storeCustomer.findUnique({ where: { id } });
      return row
        ? StoreCustomer.parse({
            id: row.id,
            createdAt: iso(row.createdAt),
            priorOrders: row.priorOrders,
            priorDisputes: row.priorDisputes,
            knownIps: row.knownIps,
            knownDevices: row.knownDevices,
          })
        : null;
    },

    async refunds(id: string): Promise<StoreRefundValue[]> {
      const rows = await db.storeRefund.findMany({
        where: { orderId: id },
        orderBy: [{ refundedAt: "asc" }, { id: "asc" }],
      });
      return rows.map((row) =>
        StoreRefund.parse({ id: row.id, amountCents: row.amountCents, refundedAt: iso(row.refundedAt) }),
      );
    },

    async shipments(id: string): Promise<StoreShipmentValue[]> {
      const rows = await db.storeShipment.findMany({
        where: { orderId: id },
        orderBy: [{ shippedAt: "asc" }, { id: "asc" }],
      });
      return rows.map((row) =>
        StoreShipment.parse({
          id: row.id,
          orderId: row.orderId,
          carrier: row.carrier,
          trackingNumber: row.trackingNumber,
          status: row.status,
          address: row.address,
          history: row.history,
          shippedAt: row.shippedAt ? iso(row.shippedAt) : null,
          deliveredAt: row.deliveredAt ? iso(row.deliveredAt) : null,
        }),
      );
    },

    async subscription(id: string): Promise<StoreSubscriptionValue | null> {
      const row = await db.storeSubscription.findUnique({ where: { orderId: id } });
      return row
        ? StoreSubscription.parse({
            id: row.id,
            status: row.status,
            chargedAt: row.chargedAt ? iso(row.chargedAt) : null,
            cancelledAt: row.cancelledAt ? iso(row.cancelledAt) : null,
            termsUrl: row.termsUrl,
          })
        : null;
    },
  };
}

export type StoreRecords = ReturnType<typeof createStoreRecords>;
