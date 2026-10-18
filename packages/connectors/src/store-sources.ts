import type { EvidenceItem } from "@rebuttal/core";
import { orderRef, type StoreClient } from "./store/client.js";
import type { StoreMessage } from "./store/schema.js";
import type { ConnectorCase, EvidenceSource } from "./types.js";

// Connectors over the seller's store records (plan Day 6, B). Message text is untrusted
// buyer input: stored verbatim here, fenced off before any agent sees it.

const MAX_MESSAGES = 50;
const MAX_TEXT = 2000;
const HOUR = 3_600_000;

const iso = (s: string | null | undefined) => {
  const t = s ? Date.parse(s) : NaN;
  return Number.isNaN(t) ? null : new Date(t).toISOString();
};

interface ThreadMessage {
  from: "BUYER" | "SELLER" | "PAYPAL";
  at: string | null;
  channel: string;
  text: string;
}

function fromPayPal(postedBy: string): ThreadMessage["from"] {
  if (postedBy === "SELLER") return "SELLER";
  if (postedBy === "BUYER") return "BUYER";
  return "PAYPAL";
}

/** Store messages + the PayPal dispute thread, oldest first, deduplicated. */
export function mergeThread(c: ConnectorCase, store: StoreMessage[]): ThreadMessage[] {
  const all: ThreadMessage[] = [
    ...store.map((m) => ({
      from: m.from === "seller" ? ("SELLER" as const) : ("BUYER" as const),
      at: iso(m.at),
      channel: m.channel,
      text: m.text.slice(0, MAX_TEXT),
    })),
    ...c.messages.map((m) => ({
      from: fromPayPal(m.postedBy),
      at: iso(m.postedAt),
      channel: "paypal",
      text: m.content.slice(0, MAX_TEXT),
    })),
  ];
  const seen = new Set<string>();
  return all
    .filter((m) => {
      const k = `${m.from}|${m.at}|${m.text}`;
      return !seen.has(k) && (seen.add(k), true);
    })
    .sort((a, b) => (a.at ?? "").localeCompare(b.at ?? ""))
    .slice(-MAX_MESSAGES);
}

export function threadStats(thread: ThreadMessage[]) {
  const firstBuyer = thread.find((m) => m.from === "BUYER");
  const reply = firstBuyer
    ? thread.find((m) => m.from === "SELLER" && (m.at ?? "") >= (firstBuyer.at ?? ""))
    : undefined;
  return {
    sellerReplied: !!reply,
    firstSellerReplyHours:
      reply?.at && firstBuyer?.at
        ? Math.round(((Date.parse(reply.at) - Date.parse(firstBuyer.at)) / HOUR) * 10) / 10
        : null,
    buyerMessageCount: thread.filter((m) => m.from === "BUYER").length,
  };
}

export function createMessagesSource(
  store: StoreClient | null,
  now: () => Date = () => new Date(),
): EvidenceSource {
  return {
    id: "messages",
    supports: (c) => c.messages.length > 0 || !!store,
    async gather(c) {
      const order = store ? await store.findOrder(orderRef(c)) : null;
      const thread = mergeThread(c, order && store ? await store.messages(order.id) : []);
      if (!thread.length) return [];
      return [
        {
          source: "messages",
          type: "OTHER",
          title: `Buyer–seller messages (${thread.length})`,
          dedupeKey: `thread:${c.paypalDisputeId}`,
          capturedAt: now().toISOString(),
          data: {
            kind: "message_thread",
            orderId: order?.id ?? null,
            messages: thread,
            ...threadStats(thread),
          },
        },
      ];
    },
  };
}

/** Download/access log for digital goods: proof the buyer received what they paid for. */
export function createDownloadLogSource(
  store: StoreClient,
  now: () => Date = () => new Date(),
): EvidenceSource {
  return {
    id: "download-log",
    supports: () => true,
    async gather(c) {
      const order = await store.findOrder(orderRef(c));
      if (!order?.digital) return [];
      const events = (await store.accessLog(order.id))
        .map((e) => ({ at: iso(e.at), ip: e.ip ?? null, action: e.action }))
        .filter((e) => e.at)
        .sort((a, b) => a.at!.localeCompare(b.at!));
      const placed = Date.parse(order.placedAt);
      const after = events.filter((e) => Date.parse(e.at!) >= placed);
      const checkoutIp = order.checkout?.ip ?? null;
      const item: EvidenceItem = {
        source: "download-log",
        type: "PROOF_FOR_SOFTWARE_OR_SERVICE_DELIVERED",
        title: `Download log: ${after.length} access(es) after purchase`,
        dedupeKey: `access:${order.id}`,
        capturedAt: now().toISOString(),
        data: {
          kind: "access_log",
          orderId: order.id,
          events: events.slice(-MAX_MESSAGES),
          firstAccessAt: after[0]?.at ?? null,
          accessCount: after.length,
          accessedAfterPurchase: after.length > 0,
          ipMatchesCheckout: checkoutIp ? after.some((e) => e.ip === checkoutIp) : null,
        },
      };
      return [item];
    },
  };
}

const AVS_MATCH = new Set(["Y", "X", "D", "M", "F"]);

/** Account records: buyer history, checkout risk checks, refunds and subscriptions. */
export function createAccountSource(store: StoreClient, now: () => Date = () => new Date()): EvidenceSource {
  return {
    id: "account",
    supports: () => true,
    async gather(c) {
      const order = await store.findOrder(orderRef(c));
      if (!order) return [];
      const at = now().toISOString();
      const items: EvidenceItem[] = [];
      const customer = order.customerId ? await store.customer(order.customerId) : null;

      if (customer) {
        items.push({
          source: "account",
          type: "OTHER",
          title: `Buyer history: ${customer.priorOrders} earlier order(s)`,
          dedupeKey: `history:${customer.id}`,
          capturedAt: at,
          data: {
            kind: "buyer_history",
            customerId: customer.id,
            priorOrders: customer.priorOrders,
            priorDisputes: customer.priorDisputes,
            accountAgeDays:
              customer.createdAt && !Number.isNaN(Date.parse(customer.createdAt))
                ? Math.floor((Date.parse(order.placedAt) - Date.parse(customer.createdAt)) / 86_400_000)
                : null,
          },
        });
      }
      if (order.checkout) {
        const ch = order.checkout;
        items.push({
          source: "account",
          type: "ORDER_DETAILS",
          title: "Checkout verification (AVS/CVV, IP, device)",
          dedupeKey: `risk:${order.id}`,
          capturedAt: at,
          data: {
            kind: "checkout_risk",
            orderId: order.id,
            avsMatch: ch.avs ? AVS_MATCH.has(ch.avs.toUpperCase()) : null,
            cvvMatch: ch.cvv ? ch.cvv.toUpperCase() === "M" : null,
            ipMatch: ch.ip && customer?.knownIps.length ? customer.knownIps.includes(ch.ip) : null,
            deviceMatch:
              ch.deviceId && customer?.knownDevices.length
                ? customer.knownDevices.includes(ch.deviceId)
                : null,
          },
        });
      }
      for (const r of await store.refunds(order.id)) {
        items.push({
          source: "account",
          type: "PROOF_OF_REFUND",
          title: `Refund ${r.id}`,
          dedupeKey: `refund:${r.id}`,
          capturedAt: at,
          data: { kind: "refund", refundId: r.id, amountCents: r.amountCents, refundedAt: iso(r.refundedAt) },
        });
      }
      const sub = await store.subscription(order.id);
      if (sub) {
        items.push({
          source: "account",
          type: "BILLING_AGREEMENT",
          title: `Subscription ${sub.id} (${sub.status})`,
          dedupeKey: `subscription:${sub.id}`,
          capturedAt: at,
          data: {
            kind: "subscription",
            subscriptionId: sub.id,
            status: sub.status,
            chargedAt: iso(sub.chargedAt),
            cancelledAt: iso(sub.cancelledAt),
            termsUrl: sub.termsUrl ?? null,
          },
        });
      }
      return items;
    },
  };
}
