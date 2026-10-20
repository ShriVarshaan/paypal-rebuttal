import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { loadFixtureStore } from "./store/client.js";
import { createStorefrontCaptureService } from "./storefront-capture.js";

const snapshot = (await loadFixtureStore().product("product-legacy-jacket"))!.currentSnapshot;

describe("storefront capture", () => {
  it("reuses a valid existing capture without opening a browser", async () => {
    const root = join(tmpdir(), `rebuttal-capture-${randomUUID()}`);
    const directory = join(root, "case-1");
    const filename = `listing-${snapshot.id}-${snapshot.rendererVersion}.png`;
    await mkdir(directory, { recursive: true });
    const output = join(directory, filename);
    await writeFile(output, Buffer.from("synthetic-png"));

    const result = await createStorefrontCaptureService({ mode: "fixture", storageDir: root }).capture({
      caseId: "case-1",
      productId: snapshot.productId,
      slug: "legacy-waxed-canvas-jacket",
      orderId: "ord_1002",
      snapshot,
    });
    expect(result).toMatchObject({ status: "captured", filePath: output, sizeBytes: 13 });
  });

  it.skipIf(process.env["RUN_REAL_BROWSER"] !== "1")(
    "captures the shared fixture listing as a full-page PNG",
    async () => {
      const root = join(tmpdir(), `rebuttal-capture-${randomUUID()}`);
      const result = await createStorefrontCaptureService({
        mode: "fixture",
        storageDir: root,
        assetsDir: join(process.cwd(), "apps/demo-store/public"),
      }).capture({
        caseId: "case-browser",
        productId: snapshot.productId,
        slug: "legacy-waxed-canvas-jacket",
        orderId: "ord_1002",
        snapshot,
      });
      expect(result.status).toBe("captured");
      const bytes = await readFile(result.filePath!);
      expect(bytes.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
      expect(bytes.length).toBeGreaterThan(10_000);
    },
  );
});
