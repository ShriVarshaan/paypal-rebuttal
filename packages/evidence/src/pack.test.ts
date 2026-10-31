import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PDFDocument, PDFName } from "pdf-lib";
import { describe, expect, it } from "vitest";
import type { PdfEngine } from "./engine.js";
import { buildTimeline, groupByEvidenceType, maskIp, orderExhibits } from "./model.js";
import { buildEvidencePack, PackTooLargeError } from "./pack.js";
import type { PackEvidence, PackInput } from "./types.js";

const evidence = (
  over: Partial<PackEvidence> & Pick<PackEvidence, "id" | "type" | "data">,
): PackEvidence => ({
  source: "test",
  title: over.id,
  capturedAt: "2026-10-10T00:00:00.000Z",
  filePath: null,
  ...over,
});

const tracking = evidence({
  id: "ev-track",
  source: "easypost",
  type: "PROOF_OF_FULFILLMENT",
  data: {
    trackingCode: "9400100000000000000000",
    carrier: "USPS",
    status: "delivered",
    deliveredAt: "2026-10-06T15:00:00.000Z",
    deliveredTo: { city: "Portland", state: "OR", zip: "97201" },
    shippingPostalCode: "97201",
    events: [
      { status: "pre_transit", at: "2026-10-03T10:00:00.000Z" },
      { status: "delivered", at: "2026-10-06T15:00:00.000Z" },
    ],
  },
});
const order = evidence({
  id: "ev-order",
  source: "storefront",
  type: "ORDER_DETAILS",
  data: {
    kind: "order",
    orderId: "ord_1",
    placedAt: "2026-10-02T14:21:07.000Z",
    totalCents: 4900,
    currency: "USD",
    items: [],
  },
});
const listing = evidence({
  id: "ev-listing",
  source: "storefront",
  type: "ITEM_DESCRIPTION",
  filePath: "listing.png",
  data: {
    kind: "listing_snapshot",
    title: "Moss glaze mug",
    capturedAt: "2026-09-01T00:00:00.000Z",
    orderedAt: "2026-10-02T14:21:07.000Z",
  },
});
const diagnostic = evidence({
  id: "ev-diag",
  type: "OTHER",
  data: { diagnostic: "Store order could not be resolved." },
});

const input = (over: Partial<PackInput> = {}): PackInput => ({
  caseId: "case-1",
  decisionId: "dec-1",
  paypalDisputeId: "PP-D-90001",
  reason: "MERCHANDISE_OR_SERVICE_NOT_RECEIVED",
  stage: "INQUIRY",
  amountCents: 4900,
  currency: "USD",
  sellerTransactionId: "3VK13355SM0012345",
  invoiceNumber: "INV-1001",
  paypalCreatedAt: "2026-10-15T09:12:44.000Z",
  sellerResponseDueAt: "2026-10-29T23:59:59.000Z",
  transactionCreatedAt: "2026-10-02T14:21:10.000Z",
  merchant: { name: "Fern & Field Goods" },
  narrative: {
    headline: "The order was delivered to the buyer's address.",
    claims: [{ text: "USPS confirmed delivery on 6 October.", exhibits: ["EX-1"] }],
    source: "template",
    rejectedClaims: 0,
    needsReview: false,
    notesByType: {},
  },
  note: "Delivered (EX-1).",
  exhibitMap: null,
  evidence: [tracking, order, listing, diagnostic],
  transactionContext: null,
  generatedAt: "2026-10-16T00:00:00.000Z",
  ...over,
});

/** A browser stand-in: one page per section; image bytes inflate the PDF the way real ones do. */
function fakeEngine(): PdfEngine & { pdfCalls: number } {
  const engine = {
    pdfCalls: 0,
    async pdf(html: string) {
      engine.pdfCalls++;
      const doc = await PDFDocument.create();
      const page = doc.addPage();
      // Carry the HTML (and so any embedded image) on the page, which survives the merge.
      const payload = doc.context.register(doc.context.stream(new TextEncoder().encode(html)));
      page.node.set(PDFName.of("FakeContent"), payload);
      return doc.save();
    },
    async jpeg(_image: Uint8Array, _mime: string, opts: { maxWidth: number; quality: number }) {
      // Random bytes: real JPEG data does not compress further inside the PDF.
      return new Uint8Array(randomBytes(opts.maxWidth * opts.quality * 4));
    },
    async close() {},
  };
  return engine;
}

describe("exhibit order", () => {
  it("numbers deterministically and never turns a lookup diagnostic into an exhibit", () => {
    const xs = orderExhibits(input());
    expect(xs.map((x) => [x.exhibitId, x.evidence.id])).toEqual([
      ["EX-1", "ev-track"],
      ["EX-2", "ev-listing"],
      ["EX-3", "ev-order"],
    ]);
  });

  it("keeps the numbering the decision's narrative cites and appends later evidence", () => {
    const xs = orderExhibits(
      input({
        evidence: [tracking, order],
        exhibitMap: [
          { exhibitId: "EX-1", evidenceId: "ev-order" },
          { exhibitId: "EX-2", evidenceId: "ev-track" },
        ],
      }),
    );
    expect(xs.map((x) => x.evidence.id)).toEqual(["ev-order", "ev-track"]);
    const later = orderExhibits(
      input({
        exhibitMap: [
          { exhibitId: "EX-1", evidenceId: "ev-order" },
          { exhibitId: "EX-2", evidenceId: "ev-track" },
        ],
      }),
    );
    expect(later.map((x) => [x.exhibitId, x.evidence.id])).toEqual([
      ["EX-1", "ev-order"],
      ["EX-2", "ev-track"],
      ["EX-3", "ev-listing"],
    ]);
  });

  it("renumbers when a stored exhibit no longer exists", () => {
    const xs = orderExhibits(
      input({ evidence: [tracking], exhibitMap: [{ exhibitId: "EX-1", evidenceId: "gone" }] }),
    );
    expect(xs.map((x) => x.exhibitId)).toEqual(["EX-1"]);
  });
});

describe("timeline and grouping", () => {
  it("orders order → payment → carrier → delivery → dispute", () => {
    const rows = buildTimeline(input(), orderExhibits(input()));
    expect(rows.map((r) => r.label)).toEqual([
      "Order placed",
      "Payment captured",
      "In carrier network",
      "Delivered",
      "Dispute opened",
    ]);
    expect(rows.find((r) => r.label === "Delivered")?.exhibitId).toBe("EX-1");
  });

  it("groups exhibits by PayPal evidence type in first-exhibit order", () => {
    expect(groupByEvidenceType(orderExhibits(input())).map((g) => g.evidenceType)).toEqual([
      "PROOF_OF_FULFILLMENT",
      "ITEM_DESCRIPTION",
      "ORDER_DETAILS",
    ]);
  });

  it("masks customer IPs", () => {
    expect(maskIp("203.0.113.42")).toBe("203.0.113.•••");
    expect(maskIp("2001:db8:85a3:0:0:8a2e:370:7334")).toBe("2001:db8:85a3:••••");
    expect(maskIp(null)).toBe("—");
  });
});

describe("buildEvidencePack", () => {
  const readFileStub = async () => new Uint8Array([137, 80, 78, 71]);

  it("splits submission files per evidence type with the cover letter first", async () => {
    const outDir = await mkdtemp(join(tmpdir(), "rebuttal-pack-"));
    const result = await buildEvidencePack(input(), { engine: fakeEngine(), outDir, readFile: readFileStub });
    expect(result.files.map((f) => [f.evidenceType, f.exhibits, f.pages])).toEqual([
      ["PROOF_OF_FULFILLMENT", ["EX-1"], 2],
      ["ITEM_DESCRIPTION", ["EX-2"], 1],
      ["ORDER_DETAILS", ["EX-3"], 1],
    ]);
    expect(result.preview.pages).toBe(4);
    expect(result.totalBytes).toBe(result.files.reduce((s, f) => s + f.sizeBytes, 0));
    expect(result.profile).toBe("standard");
    const preview = await PDFDocument.load(await readFile(result.preview.path));
    expect(preview.getPageCount()).toBe(4);
  });

  it("steps image quality down until every file fits", async () => {
    const outDir = await mkdtemp(join(tmpdir(), "rebuttal-pack-"));
    const result = await buildEvidencePack(input(), {
      engine: fakeEngine(),
      outDir,
      readFile: readFileStub,
      maxFileBytes: 400_000,
    });
    expect(result.profile).toBe("compact");
    expect(result.files.every((f) => f.sizeBytes <= 400_000)).toBe(true);
    expect(result.warnings.some((w) => w.includes("standard"))).toBe(true);
  });

  it("fails loudly when even a text-only pack is too big", async () => {
    const outDir = await mkdtemp(join(tmpdir(), "rebuttal-pack-"));
    await expect(
      buildEvidencePack(input(), { engine: fakeEngine(), outDir, readFile: readFileStub, maxFileBytes: 100 }),
    ).rejects.toBeInstanceOf(PackTooLargeError);
  });

  it("still builds a statement-only file when there is no evidence", async () => {
    const outDir = await mkdtemp(join(tmpdir(), "rebuttal-pack-"));
    const result = await buildEvidencePack(input({ evidence: [] }), { engine: fakeEngine(), outDir });
    expect(result.files).toHaveLength(1);
    expect(result.files[0]).toMatchObject({ evidenceType: "OTHER", exhibits: [] });
  });

  it("notes a missing screenshot instead of failing", async () => {
    const outDir = await mkdtemp(join(tmpdir(), "rebuttal-pack-"));
    const result = await buildEvidencePack(input(), {
      engine: fakeEngine(),
      outDir,
      readFile: async () => {
        throw new Error("ENOENT");
      },
    });
    expect(result.warnings.join(" ")).toContain("EX-2: screenshot file is missing");
  });
});

const chromiumReady = await (async () => {
  try {
    const { chromium } = await import("playwright");
    return existsSync(chromium.executablePath());
  } catch {
    return false;
  }
})();

describe.skipIf(!chromiumReady)("real Chromium", () => {
  it("renders a readable multi-page pack", { timeout: 60_000 }, async () => {
    const { launchPdfEngine } = await import("./engine.js");
    const engine = await launchPdfEngine();
    try {
      const outDir = await mkdtemp(join(tmpdir(), "rebuttal-pack-"));
      const result = await buildEvidencePack(input({ evidence: [tracking, order] }), { engine, outDir });
      const pdf = await PDFDocument.load(await readFile(result.preview.path));
      expect(pdf.getPageCount()).toBeGreaterThanOrEqual(3);
      expect(pdf.getTitle()).toBe("Evidence pack PP-D-90001");
      expect(result.files[0]!.sizeBytes).toBeGreaterThan(5_000);
    } finally {
      await engine.close();
    }
  });
});
