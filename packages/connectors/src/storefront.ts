import type { ListingSnapshot, EvidenceItem } from "@rebuttal/core";
import type { OrderRef, StoreClient } from "./store/client.js";
import type { ConnectorCase, EvidenceSource } from "./types.js";
import type { StoreOrder, StoreShipment } from "./store/schema.js";

export interface StorefrontCaptureRequest {
  caseId: string;
  productId: string;
  slug: string;
  orderId: string;
  snapshot: ListingSnapshot;
}

export interface StorefrontCaptureResult {
  status: "captured" | "failed";
  filePath?: string;
  sizeBytes?: number;
  capturedAt: string;
  error?: string;
}

export interface StorefrontCaptureService {
  capture(request: StorefrontCaptureRequest): Promise<StorefrontCaptureResult>;
}

export interface StorefrontSourceOptions {
  now?: () => Date;
  capture?: StorefrontCaptureService;
}

interface Resolution {
  order: StoreOrder | null;
  diagnostic?: string;
  exact: boolean;
}

const iso = (value: string | null | undefined): string | null => {
  const parsed = value ? Date.parse(value) : NaN;
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
};

function suppliedRefs(c: ConnectorCase): Array<{ label: string; ref: OrderRef }> {
  const transaction = c.disputedTransactions[0];
  const refs: Array<{ label: string; ref: OrderRef }> = [];
  if (transaction?.invoiceNumber) {
    refs.push({ label: "invoiceNumber", ref: { invoiceNumber: transaction.invoiceNumber } });
  }
  if (transaction?.sellerTransactionId) {
    refs.push({ label: "captureId", ref: { captureId: transaction.sellerTransactionId } });
  } else if (c.transactionContext?.capture?.id) {
    refs.push({ label: "captureId", ref: { captureId: c.transactionContext.capture.id } });
  }
  if (c.transactionContext?.order?.id) {
    refs.push({ label: "orderId", ref: { orderId: c.transactionContext.order.id } });
  }
  return refs;
}

async function resolveOrder(store: StoreClient, c: ConnectorCase): Promise<Resolution> {
  const refs = suppliedRefs(c);
  if (refs.length) {
    const results = await Promise.all(
      refs.map(async ({ label, ref }) => ({ label, order: await store.findOrder(ref) })),
    );
    if (results.some((result) => !result.order)) {
      return {
        order: null,
        exact: true,
        diagnostic: `An exact store lookup failed for ${results.find((result) => !result.order)?.label}.`,
      };
    }
    const distinct = new Set(results.map((result) => result.order!.id));
    if (distinct.size !== 1) {
      return {
        order: null,
        exact: true,
        diagnostic: `Supplied identifiers resolve to conflicting store orders: ${[...distinct].join(", ")}.`,
      };
    }
    return { order: results[0]!.order, exact: true };
  }

  const transaction = c.disputedTransactions[0];
  const placedAt =
    iso(c.transactionContext?.order?.createdAt) ??
    iso(c.transactionContext?.capture?.createdAt) ??
    iso(transaction?.createdAt);
  if (!placedAt || !Number.isFinite(c.amount.cents)) {
    return {
      order: null,
      exact: false,
      diagnostic: "No exact identifier or valid purchase timestamp was available for fallback matching.",
    };
  }
  const sku = c.transactionContext?.order?.items.find((item) => item.sku)?.sku ?? undefined;
  const candidates = await store.searchOrders({
    totalCents: c.amount.cents,
    currency: c.amount.currency,
    placedAt,
    sku,
  });
  if (candidates.length !== 1) {
    return {
      order: null,
      exact: false,
      diagnostic: `Fallback store matching found ${candidates.length} candidates; exactly one is required.`,
    };
  }
  return { order: candidates[0]!, exact: false };
}

function diagnostic(caseId: string, message: string, now: () => Date): EvidenceItem {
  return {
    source: "storefront",
    type: "OTHER",
    title: "Storefront lookup diagnostic",
    dedupeKey: `diagnostic:${caseId}`,
    capturedAt: now().toISOString(),
    data: { diagnostic: message, orderResolved: false },
  };
}

function orderEvidence(
  order: StoreOrder,
  shipments: StoreShipment[],
  exact: boolean,
  now: () => Date,
): EvidenceItem {
  return {
    source: "storefront",
    type: "ORDER_DETAILS",
    title: `Store order ${order.id}`,
    dedupeKey: `order:${order.id}`,
    capturedAt: now().toISOString(),
    data: {
      kind: "order",
      orderId: order.id,
      invoiceNumber: order.invoiceNumber ?? null,
      paypalCaptureId: order.paypalCaptureId ?? null,
      paypalOrderId: order.paypalOrderId ?? null,
      placedAt: iso(order.placedAt),
      totalCents: order.totalCents,
      agreedAmountCents: order.totalCents,
      currency: order.currency,
      items: order.items,
      shipments,
      exactIdentifierMatch: exact,
      singlePaymentMethod: true,
    },
  };
}

function diffEvidence(
  order: StoreOrder,
  original: ListingSnapshot,
  current: ListingSnapshot,
  now: () => Date,
): EvidenceItem | null {
  if (original.title === current.title && original.description === current.description) return null;
  return {
    source: "storefront",
    type: "OTHER",
    title: `Listing changed after order: ${original.title}`,
    dedupeKey: `listing-diff:${order.id}:${original.id}:${current.id}`,
    capturedAt: now().toISOString(),
    data: {
      kind: "listing_diff",
      orderId: order.id,
      originalSnapshot: {
        id: original.id,
        revision: original.revision,
        title: original.title,
        description: original.description,
        capturedAt: original.capturedAt,
      },
      currentSnapshot: {
        id: current.id,
        revision: current.revision,
        title: current.title,
        description: current.description,
        capturedAt: current.capturedAt,
      },
      changedFields: [
        ...(original.title === current.title ? [] : ["title"]),
        ...(original.description === current.description ? [] : ["description"]),
      ],
    },
  };
}

/** Store evidence: exact order resolution, pinned/as-of listings, shipment facts, and immutable screenshot metadata. */
export function createStorefrontSource(
  store: StoreClient,
  options: StorefrontSourceOptions = {},
): EvidenceSource {
  const now = options.now ?? (() => new Date());
  return {
    id: "storefront",
    supports: () => true,
    async gather(c) {
      const resolution = await resolveOrder(store, c);
      if (!resolution.order)
        return [diagnostic(c.id, resolution.diagnostic ?? "Store order could not be resolved.", now)];
      const order = resolution.order;
      const placedAt = iso(order.placedAt);
      if (!placedAt) return [diagnostic(c.id, "Matched store order has an invalid purchase timestamp.", now)];
      const shipments = await store.shipments(order.id);
      const items: EvidenceItem[] = [orderEvidence(order, shipments, resolution.exact, now)];
      for (const item of order.items) {
        const product = item.productId
          ? await store.product(item.productId)
          : item.sku
            ? await store.product(item.sku)
            : null;
        if (!product) {
          items.push(
            diagnostic(c.id, `No catalog product was found for order item ${item.sku ?? item.name}.`, now),
          );
          continue;
        }
        const pinned = item.listingSnapshotId
          ? await store.listingSnapshotById(product.id, item.listingSnapshotId)
          : null;
        const snapshot = pinned ?? (await store.listingSnapshot(product.id, placedAt));
        if (!snapshot || Date.parse(snapshot.capturedAt) > Date.parse(placedAt)) {
          items.push(
            diagnostic(c.id, `No valid purchase-time listing snapshot was found for ${item.name}.`, now),
          );
          continue;
        }
        const current = product.currentSnapshot;
        let capture: StorefrontCaptureResult | undefined;
        if (options.capture) {
          try {
            capture = await options.capture.capture({
              caseId: c.id,
              productId: product.id,
              slug: product.slug,
              orderId: order.id,
              snapshot,
            });
          } catch (error) {
            capture = {
              status: "failed",
              capturedAt: now().toISOString(),
              error: error instanceof Error ? error.message : String(error),
            };
          }
        }
        const evidence: EvidenceItem = {
          source: "storefront",
          type: "ITEM_DESCRIPTION",
          title: `Listing at order: ${snapshot.title}`,
          dedupeKey: `listing:${order.id}:${item.productId ?? item.sku ?? item.name}:${snapshot.id}`,
          capturedAt: now().toISOString(),
          ...(capture?.filePath ? { filePath: capture.filePath } : {}),
          data: {
            kind: "listing_snapshot",
            orderId: order.id,
            productId: product.id,
            snapshotId: snapshot.id,
            revision: snapshot.revision,
            rendererVersion: snapshot.rendererVersion,
            capturedAt: snapshot.capturedAt,
            orderedAt: placedAt,
            title: snapshot.title,
            description: snapshot.description,
            photos: snapshot.assets,
            price: { cents: snapshot.priceCents, currency: snapshot.currency },
            captureStatus: capture?.status ?? "not_requested",
            captureError: capture?.error ?? null,
            screenshotCapturedAt: capture?.capturedAt ?? null,
            snapshotPublishedAt: snapshot.capturedAt,
          },
        };
        items.push(evidence);
        const diff = diffEvidence(order, snapshot, current, now);
        if (diff) items.push(diff);
      }
      return items;
    },
  };
}
