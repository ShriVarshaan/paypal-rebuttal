import type { EvalCase, EvalEvidence } from "./schema.js";

// Terse builders for eval cases. Evidence follows the data conventions in
// packages/core/src/evidence-kinds.ts, so the engine reads it exactly as it reads connectors.

export const NR = "MERCHANDISE_OR_SERVICE_NOT_RECEIVED";
export const NAD = "MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED";
export const UNAUTH = "UNAUTHORISED";
export const CNP = "CREDIT_NOT_PROCESSED";
export const DUP = "DUPLICATE_TRANSACTION";
export const INC = "INCORRECT_AMOUNT";
export const CRB = "CANCELED_RECURRING_BILLING";

const DAY = 86_400_000;
const iso = (ms: number) => new Date(ms).toISOString();

export class EvidenceBuilder {
  private n = 0;
  constructor(private readonly paidAt: string) {}
  private id(kind: string) {
    return `${kind}-${++this.n}`;
  }
  private at(days: number) {
    return iso(Date.parse(this.paidAt) + days * DAY);
  }

  tracking(
    status: string,
    o: { zip?: string | null; ship?: string; signedBy?: string | null } = {},
  ): EvalEvidence {
    const delivered = status === "delivered";
    return {
      id: this.id("trk"),
      source: "easypost",
      type: "PROOF_OF_FULFILLMENT",
      title: `Carrier tracking: ${status}`,
      data: {
        trackingCode: `EZ${String(1000000000 + this.n * 7919).slice(0, 10)}`,
        carrier: "USPS",
        status,
        deliveredAt: delivered ? this.at(3) : null,
        deliveredTo: delivered && o.zip !== null ? { zip: o.zip ?? o.ship ?? "95131" } : null,
        shippingPostalCode: o.ship ?? "95131",
        signedBy: o.signedBy ?? null,
      },
    };
  }
  thread(sellerReplied: boolean, buyerText = "Where is my order?"): EvalEvidence {
    const messages = [
      { from: "BUYER", at: this.at(6), channel: "email", text: buyerText },
      ...(sellerReplied
        ? [
            {
              from: "SELLER",
              at: this.at(6.3),
              channel: "email",
              text: "Sorry about that — here's what our records show.",
            },
          ]
        : []),
    ];
    return {
      id: this.id("msg"),
      source: "messages",
      type: "OTHER",
      title: `Buyer–seller messages (${messages.length})`,
      data: {
        kind: "message_thread",
        messages,
        sellerReplied,
        firstSellerReplyHours: sellerReplied ? 7.2 : null,
        buyerMessageCount: 1,
      },
    };
  }
  listing(capturedDaysBeforeOrder: number, description = "As pictured. See size chart."): EvalEvidence {
    return {
      id: this.id("lst"),
      source: "storefront",
      type: "ITEM_DESCRIPTION",
      title: "Listing snapshot",
      data: {
        kind: "listing_snapshot",
        title: "Listing",
        description,
        capturedAt: this.at(-capturedDaysBeforeOrder),
        orderedAt: this.paidAt,
      },
    };
  }
  photos(): EvalEvidence {
    return {
      id: this.id("pho"),
      source: "storefront",
      type: "PHOTOS_OF_SHIPPED_ITEM",
      title: "Packing photos",
      data: { kind: "item_photos", photos: ["a.jpg", "b.jpg"] },
    };
  }
  returnPolicy(days = 30): EvalEvidence {
    return {
      id: this.id("pol"),
      source: "storefront",
      type: "RETURN_POLICY",
      title: "Return policy",
      data: { kind: "return_policy", returnWindowDays: days },
    };
  }
  order(
    o: { digital?: boolean; agreedAmountCents?: number; distinct?: boolean; singlePayment?: boolean } = {},
  ): EvalEvidence {
    return {
      id: this.id("ord"),
      source: "storefront",
      type: "ORDER_DETAILS",
      title: "Order record",
      data: {
        kind: "order",
        orderId: `ord_${this.n}`,
        placedAt: this.paidAt,
        items: [{ name: "Item", digital: !!o.digital }],
        ...(o.agreedAmountCents !== undefined ? { agreedAmountCents: o.agreedAmountCents } : {}),
        ...(o.distinct !== undefined ? { distinctFromOtherCharge: o.distinct } : {}),
        ...(o.singlePayment !== undefined ? { singlePaymentMethod: o.singlePayment } : {}),
      },
    };
  }
  access(count: number, ipMatch: boolean | null = true): EvalEvidence {
    return {
      id: this.id("acc"),
      source: "download-log",
      type: "PROOF_FOR_SOFTWARE_OR_SERVICE_DELIVERED",
      title: `Download log: ${count} access(es)`,
      data: {
        kind: "access_log",
        accessCount: count,
        accessedAfterPurchase: count > 0,
        firstAccessAt: count ? this.at(0.01) : null,
        ipMatchesCheckout: count ? ipMatch : null,
      },
    };
  }
  history(priorOrders: number, priorDisputes = 0): EvalEvidence {
    return {
      id: this.id("his"),
      source: "account",
      type: "OTHER",
      title: "Buyer history",
      data: { kind: "buyer_history", priorOrders, priorDisputes },
    };
  }
  risk(o: {
    avs?: boolean | null;
    cvv?: boolean | null;
    ip?: boolean | null;
    device?: boolean | null;
  }): EvalEvidence {
    return {
      id: this.id("rsk"),
      source: "account",
      type: "ORDER_DETAILS",
      title: "Checkout verification",
      data: {
        kind: "checkout_risk",
        avsMatch: o.avs ?? null,
        cvvMatch: o.cvv ?? null,
        ipMatch: o.ip ?? null,
        deviceMatch: o.device ?? null,
      },
    };
  }
  refund(amountCents: number): EvalEvidence {
    return {
      id: this.id("ref"),
      source: "account",
      type: "PROOF_OF_REFUND",
      title: "Refund record",
      data: { kind: "refund", refundId: `R-${this.n}`, amountCents, refundedAt: this.at(5) },
    };
  }
  subscription(cancelledDaysAfterCharge: number | null): EvalEvidence {
    return {
      id: this.id("sub"),
      source: "account",
      type: "BILLING_AGREEMENT",
      title: "Subscription record",
      data: {
        kind: "subscription",
        status: cancelledDaysAfterCharge === null ? "active" : "cancelled",
        chargedAt: this.paidAt,
        cancelledAt: cancelledDaysAfterCharge === null ? null : this.at(cancelledDaysAfterCharge),
      },
    };
  }
}

export const INQUIRY_OPTIONS = {
  make_offer: { offer_types: ["REFUND", "REFUND_WITH_RETURN"] },
  accept_claim: { accept_claim_types: ["REFUND"] },
};
export const CLAIM_OPTIONS = { accept_claim: { accept_claim_types: ["REFUND"] } };

export interface DisputeSpec {
  id: string;
  title: string;
  reason: string;
  stage: "INQUIRY" | "CHARGEBACK" | "PRE_ARBITRATION";
  amount: number;
  paidAt: string;
  openedAfterDays?: number;
  buyer?: string;
  items?: string[];
}

export function dispute(s: DisputeSpec): EvalCase["dispute"] {
  const opened = Date.parse(s.paidAt) + (s.openedAfterDays ?? 12) * DAY;
  return {
    reason: s.reason,
    stage: s.stage,
    amountCents: Math.round(s.amount * 100),
    currency: "USD",
    paidAt: s.paidAt,
    openedAt: iso(opened),
    dueAt: iso(opened + 10 * DAY),
    allowedResponseOptions: s.stage === "INQUIRY" ? INQUIRY_OPTIONS : CLAIM_OPTIONS,
    messages: s.buyer ? [{ postedBy: "BUYER", postedAt: iso(opened), content: s.buyer }] : [],
    items: s.items ?? ["Item"],
  };
}
