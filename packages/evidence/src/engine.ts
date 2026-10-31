/** What the pack builder needs from a browser. Tests inject a fake; production uses Chromium. */
export interface PdfEngine {
  /** HTML (with its own print CSS) → PDF bytes. */
  pdf(html: string): Promise<Uint8Array>;
  /** Re-encode a screenshot as JPEG no wider than `maxWidth`, so packs stay under PayPal's limits. */
  jpeg(image: Uint8Array, mimeType: string, opts: { maxWidth: number; quality: number }): Promise<Uint8Array>;
  close(): Promise<void>;
}

/**
 * Playwright Chromium. One browser per engine; each call uses a fresh page so a failed render
 * never leaks state into the next. Needs `pnpm browser:install` once per machine.
 */
export async function launchPdfEngine(): Promise<PdfEngine> {
  const { chromium } = await import("playwright");
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    locale: "en-US",
    colorScheme: "light",
    reducedMotion: "reduce",
  });
  return {
    async pdf(html) {
      const page = await context.newPage();
      try {
        await page.setContent(html, { waitUntil: "load" });
        await page.emulateMedia({ media: "print" });
        return new Uint8Array(
          await page.pdf({ format: "Letter", printBackground: true, preferCSSPageSize: true }),
        );
      } finally {
        await page.close();
      }
    },
    async jpeg(image, mimeType, { maxWidth, quality }) {
      const page = await context.newPage();
      try {
        await page.setViewportSize({ width: maxWidth, height: 800 });
        const src = `data:${mimeType};base64,${Buffer.from(image).toString("base64")}`;
        await page.setContent(
          `<html><body style="margin:0"><img id="i" style="display:block;max-width:${maxWidth}px;width:auto" src="${src}"></body></html>`,
          { waitUntil: "load" },
        );
        const img = page.locator("#i");
        return new Uint8Array(await img.screenshot({ type: "jpeg", quality }));
      } finally {
        await page.close();
      }
    },
    async close() {
      await context.close().catch(() => {});
      await browser.close().catch(() => {});
    },
  };
}
