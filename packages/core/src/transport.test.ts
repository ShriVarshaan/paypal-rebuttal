import { describe, expect, it } from "vitest";
import {
  CaseQueueItem,
  EvidenceChecklist,
  ListingSnapshot,
  MerchantSummary,
  StoreProductListing,
} from "./index.js";

const listing = {
  id: "snapshot-bowl-r1",
  productId: "product-bowl",
  title: "Speckled bowl",
  description: "Stoneware serving bowl",
  priceCents: 7450,
  currency: "USD",
  attributes: { category: "ceramics", digital: false },
  assets: [{ id: "catalog-v1/bowl/hero", role: "hero", src: "/catalog/v1/bowl.webp", alt: "Bowl" }],
  capturedAt: "2026-10-01T10:00:00.000Z",
  revision: 1,
  rendererVersion: "storefront-v1",
};

describe("approved additive transport contracts", () => {
  it("parses the merchant and immutable product listing", () => {
    expect(
      MerchantSummary.parse({ id: "default", name: "Fern & Field Goods", defaultCurrency: "USD" }),
    ).toMatchObject({ id: "default" });
    expect(ListingSnapshot.parse(listing)).toEqual(listing);
    expect(
      StoreProductListing.parse({
        id: "product-bowl",
        slug: "speckled-bowl",
        sku: "FF-BOWL-01",
        active: true,
        featured: true,
        currentSnapshot: listing,
      }).currentSnapshot.revision,
    ).toBe(1);
  });

  it("rejects mutable or malformed listing values", () => {
    expect(() => ListingSnapshot.parse({ ...listing, priceCents: 74.5 })).toThrow();
    expect(() => ListingSnapshot.parse({ ...listing, revision: 0 })).toThrow();
  });

  it("keeps zero pWin distinct from a missing decision", () => {
    const row = CaseQueueItem.parse({
      id: "case-1",
      merchantId: "default",
      paypalDisputeId: "PP-D-1",
      reason: "DUPLICATE_TRANSACTION",
      status: "WAITING_FOR_SELLER_RESPONSE",
      disputeState: null,
      stage: "CHARGEBACK",
      channel: null,
      amountCents: 5600,
      currency: "USD",
      sellerResponseDueAt: null,
      buyerResponseDueAt: null,
      state: "LOST",
      outcomeCode: "BUYER_FAVOR",
      withdrawn: false,
      paypalCreatedAt: "2026-10-01T10:00:00.000Z",
      paypalUpdatedAt: "2026-10-01T10:00:00.000Z",
      createdAt: "2026-10-01T10:00:00.000Z",
      updatedAt: "2026-10-01T10:00:00.000Z",
      latestDecision: {
        id: "decision-1",
        option: "ACCEPT",
        status: "PROPOSED",
        pWin: 0,
        offerAmountCents: null,
        createdAt: "2026-10-01T10:00:00.000Z",
      },
      buyerPseudonym: "Buyer T•••7",
      completeness: { score: 0, requiredMet: false, missingRequired: ["order"], missingOptional: [] },
      raw: { mustNotReachBrowser: true },
    });
    expect(row.latestDecision?.pWin).toBe(0);
    expect(row).not.toHaveProperty("raw");
  });

  it("serializes found, weak, and missing checklist states without predicates", () => {
    const checklist = EvidenceChecklist.parse({
      score: 0.5,
      requiredMet: false,
      missingRequired: ["listing_snapshot_at_order"],
      missingOptional: [],
      items: ["found", "weak", "missing"].map((status, index) => ({
        id: `requirement-${index}`,
        label: `Requirement ${index}`,
        hint: "Collect it",
        level: index === 0 ? "required" : "strong",
        paypalEvidenceType: "ITEM_DESCRIPTION",
        kind: "listing_snapshot",
        status,
        evidenceIds: [],
        exhibitIds: [],
      })),
    });
    expect(
      JSON.parse(JSON.stringify(checklist)).items.map((item: { status: string }) => item.status),
    ).toEqual(["found", "weak", "missing"]);
  });
});
