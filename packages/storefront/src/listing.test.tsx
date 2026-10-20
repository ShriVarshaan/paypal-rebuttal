import { ListingSnapshot } from "@rebuttal/core";
import { describe, expect, it } from "vitest";
import { renderListingDocument } from "./server.js";

const snapshot = ListingSnapshot.parse({
  id: "snapshot-1",
  productId: "product-1",
  title: "Archived bowl",
  description: "The purchase-time description.",
  priceCents: 4200,
  currency: "USD",
  attributes: { material: "stoneware" },
  assets: [{ id: "hero-1", role: "hero", src: "/catalog/v1/bowl.webp", alt: "A bowl" }],
  capturedAt: "2026-10-01T00:00:00.000Z",
  revision: 1,
  rendererVersion: "storefront-v1",
});

describe("versioned listing renderer", () => {
  it("renders the exact supplied snapshot through its Node-only entry point", () => {
    const html = renderListingDocument(snapshot, { mode: "historical", assetBaseUrl: "http://store.test" });
    expect(html).toContain("Archived bowl");
    expect(html).toContain("The purchase-time description.");
    expect(html).toContain("$42.00");
    expect(html).toContain("http://store.test/catalog/v1/bowl.webp");
    expect(html).toContain("Archived listing · revision 1");
  });

  it("escapes snapshot titles in document metadata", () => {
    expect(renderListingDocument({ ...snapshot, title: '<old & "fragile">' })).toContain(
      "&lt;old &amp; &quot;fragile&quot;&gt;",
    );
  });
});
