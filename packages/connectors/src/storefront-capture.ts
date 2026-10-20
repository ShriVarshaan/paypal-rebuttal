import { mkdir, rename, stat, unlink, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { renderListingDocument } from "@rebuttal/storefront/server";
import type {
  StorefrontCaptureRequest,
  StorefrontCaptureResult,
  StorefrontCaptureService,
} from "./storefront.js";

export interface StorefrontCaptureOptions {
  mode: "fixture" | "http";
  storageDir: string;
  assetsDir?: string;
  webUrl?: string;
  maxBytes?: number;
}

/** Playwright-backed capture with atomic writes, deterministic names, and retry deduplication. */
export function createStorefrontCaptureService(options: StorefrontCaptureOptions): StorefrontCaptureService {
  const storageDir = resolve(options.storageDir);
  const maxBytes = options.maxBytes ?? 10 * 1024 * 1024;
  const inFlight = new Map<string, Promise<StorefrontCaptureResult>>();
  return {
    async capture(request) {
      const key = `${request.caseId}/${request.productId}/${request.snapshot.id}/${request.snapshot.rendererVersion}`;
      const existing = inFlight.get(key);
      if (existing) return existing;
      const promise = captureOne(request, { ...options, storageDir, maxBytes });
      inFlight.set(key, promise);
      try {
        return await promise;
      } finally {
        inFlight.delete(key);
      }
    },
  };
}

async function captureOne(
  request: StorefrontCaptureRequest,
  options: StorefrontCaptureOptions & { storageDir: string; maxBytes: number },
): Promise<StorefrontCaptureResult> {
  const directory = join(options.storageDir, request.caseId);
  const filename = `listing-${safe(request.snapshot.id)}-${safe(request.snapshot.rendererVersion)}.png`;
  const output = join(directory, filename);
  try {
    const existing = await stat(output);
    if (existing.isFile() && existing.size <= options.maxBytes)
      return {
        status: "captured",
        filePath: output,
        sizeBytes: existing.size,
        capturedAt: existing.mtime.toISOString(),
      };
  } catch {
    // First capture or a prior failed atomic write.
  }
  await mkdir(directory, { recursive: true });
  const { chromium } = await import("playwright");
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({
    viewport: { width: 1280, height: 900 },
    deviceScaleFactor: 1,
    locale: "en-US",
    colorScheme: "light",
  });
  await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
  try {
    if (options.mode === "http") {
      const origin = (options.webUrl ?? "http://127.0.0.1:3002").replace(/\/$/, "");
      const response = await page.goto(
        `${origin}/p/${encodeURIComponent(request.slug)}/snapshot/${encodeURIComponent(request.snapshot.id)}`,
        { waitUntil: "networkidle" },
      );
      if (!response || !response.ok() || !page.url().startsWith(origin + "/"))
        throw new Error("historical listing page was not served from the trusted store origin");
    } else {
      const assets = resolve(options.assetsDir ?? "apps/demo-store/public");
      const assetBase = pathToFileURL(
        `${assets}${assets.endsWith("\\") || assets.endsWith("/") ? "" : "/"}`,
      ).href;
      let html = renderListingDocument(request.snapshot, { mode: "historical", assetBaseUrl: assetBase });
      html = html.replaceAll('url("/catalog/', `url("${assetBase}catalog/`);
      const htmlPath = join(directory, `.${filename}.html`);
      await writeFile(htmlPath, html, "utf8");
      try {
        await page.goto(pathToFileURL(htmlPath).href, { waitUntil: "networkidle" });
      } finally {
        await unlink(htmlPath).catch(() => undefined);
      }
    }
    const temporary = `${output}.tmp-${process.pid}-${Date.now()}.png`;
    await page.screenshot({ path: temporary, fullPage: true });
    const bytes = await stat(temporary);
    if (bytes.size > options.maxBytes) {
      await unlink(temporary).catch(() => undefined);
      return {
        status: "failed",
        capturedAt: new Date().toISOString(),
        error: `capture exceeds ${options.maxBytes} bytes`,
      };
    }
    await rename(temporary, output);
    return {
      status: "captured",
      filePath: output,
      sizeBytes: bytes.size,
      capturedAt: new Date().toISOString(),
    };
  } catch (error) {
    return {
      status: "failed",
      capturedAt: new Date().toISOString(),
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    await browser.close();
  }
}

function safe(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]+/g, "-");
}
