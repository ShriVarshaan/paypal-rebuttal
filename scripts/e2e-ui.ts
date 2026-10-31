// Day 14 milestone: the three decision paths through the UI only, timed.
//   pnpm e2e:ui                 needs `SIMULATOR=1 pnpm dev` (web :3000, api, worker, store)
//   pnpm e2e:ui --screenshots   also writes the submission gallery to docs/media/
// Each path opens a fresh simulated dispute, then uses only the browser: the queue updates
// live, the case page shows the decision and PDF, and the seller acts through the dialogs.
// Run `pnpm demo:seed --reset` first for a clean queue; the paths use a Balanced policy.
import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { createSimulatorClient, findRepoRoot } from "@rebuttal/paypal";
import type { Browser, Page } from "playwright";
import { apiUrl, postSimWebhook } from "./lib.js";

const root = findRepoRoot();
const web = (process.env["WEB_URL"] || "http://127.0.0.1:3000").replace(/\/$/, "");
const out = join(root, "storage", "test-output", "ui");
const media = join(root, "docs", "media");
const gallery = process.argv.includes("--screenshots");
const print = (line: string) => process.stdout.write(`${line}\n`);
mkdirSync(out, { recursive: true });
if (gallery) mkdirSync(media, { recursive: true });

const { chromium } = createRequire(join(root, "packages", "connectors", "package.json"))(
  "playwright",
) as typeof import("playwright");
const sim = createSimulatorClient();

/** Opens a dispute like `pnpm sim:dispute <fixture>` and returns its id. */
async function openDispute(fixture: string, dueInHours = 240): Promise<string> {
  const output = execFileSync(
    process.execPath,
    [
      join(root, "node_modules", "tsx", "dist", "cli.mjs"),
      "scripts/sim-dispute.ts",
      fixture,
      "--due-in-hours",
      String(dueInHours),
    ],
    { cwd: root, env: process.env, encoding: "utf8" },
  );
  const id = /opened (PP-D-\d+)/.exec(output)?.[1];
  if (!id) throw new Error(`could not open a ${fixture} dispute:\n${output}`);
  return id;
}

async function openCase(page: Page, disputeId: string): Promise<void> {
  await page.goto(`${web}/queue`, { waitUntil: "load" });
  // The row arrives through the live event stream; no reload.
  const card = page.getByText(disputeId).first();
  await card.waitFor({ state: "attached", timeout: 30_000 });
  await page.getByPlaceholder(/Search case/).fill(disputeId);
  // Wait for the server-side search to leave exactly this case in the grid.
  // A string runs in the page, so this script needs no DOM types.
  await page.waitForFunction(`document.querySelectorAll(".ag-row").length === 1`, undefined, {
    timeout: 15_000,
  });
  await page.locator(".ag-row").first().click();
  await page.waitForURL(/\/cases\//, { timeout: 15_000 });
  // The headline shows "Gathering evidence" until triage has decided.
  await page.locator("#decision-title", { hasText: /^(FIGHT|OFFER|ACCEPT)/ }).waitFor({ timeout: 60_000 });
}

async function shot(page: Page, name: string, fullPage = false) {
  await page.screenshot({ path: join(out, `${name}.png`), fullPage });
  if (gallery) await page.screenshot({ path: join(media, `${name}.png`), fullPage });
}

const results: { path: string; seconds: number; ok: boolean; note: string }[] = [];
async function path(name: string, run: () => Promise<string>) {
  const started = Date.now();
  try {
    const note = await run();
    results.push({ path: name, seconds: (Date.now() - started) / 1000, ok: true, note });
  } catch (err) {
    results.push({
      path: name,
      seconds: (Date.now() - started) / 1000,
      ok: false,
      note: (err as Error).message.split("\n")[0]!,
    });
  }
}

let browser: Browser | undefined;
try {
  const health = await fetch(`${apiUrl()}/healthz`).catch(() => null);
  if (!health?.ok) throw new Error(`api at ${apiUrl()} is not up; start SIMULATOR=1 pnpm dev`);
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, colorScheme: "light" });

  await path("FIGHT: approve, file, adjudicate, WON", async () => {
    const id = await openDispute("not-received");
    await openCase(page, id);
    if ((await page.locator("#decision-title").innerText()).trim() !== "FIGHT")
      throw new Error("expected FIGHT");
    await page.getByRole("button", { name: "Preview PDF" }).waitFor({ timeout: 60_000 });
    await shot(page, "decision-panel");
    await page.getByRole("button", { name: "Preview PDF" }).click();
    await page.locator("iframe[title='Evidence pack PDF']").waitFor();
    // Headless Chromium has no PDF viewer, so this shot is for the run log only.
    await page.screenshot({ path: join(out, "pdf-preview.png") });
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Approve & file" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Approve and file" }).click();
    await page.getByText("Filed with PayPal").waitFor({ timeout: 45_000 });
    await sim.disputes.adjudicate(id, "SELLER_FAVOR", `e2e-ui:${id}`);
    await postSimWebhook(sim, "CUSTOMER.DISPUTE.RESOLVED", await sim.disputes.show(id));
    await page.getByText("Resolved in your favour").waitFor({ timeout: 45_000 });
    await shot(page, "case-won", true);
    return id;
  });

  await path("OFFER: edit the amount, approve, offer pending", async () => {
    const id = await openDispute("not-as-described");
    await openCase(page, id);
    if (!(await page.locator("#decision-title").innerText()).startsWith("OFFER"))
      throw new Error("expected OFFER");
    await page.getByRole("button", { name: "Edit" }).click();
    const amount = page.getByLabel(/Offer amount/);
    await amount.fill("20.00");
    await page.getByRole("dialog").getByRole("button", { name: "Save" }).click();
    await page.locator("#decision-title", { hasText: "$20.00" }).waitFor({ timeout: 15_000 });
    await page.getByRole("button", { name: "Approve & file" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Approve and file" }).click();
    await page.getByText("Offer pending", { exact: false }).first().waitFor({ timeout: 45_000 });
    return id;
  });

  await path("ACCEPT: $8.50 digital order auto-filed by policy", async () => {
    const id = await openDispute("unauthorised");
    await openCase(page, id);
    if ((await page.locator("#decision-title").innerText()).trim() !== "ACCEPT")
      throw new Error("expected ACCEPT");
    await page
      .getByText(/Auto-filed/)
      .first()
      .waitFor({ timeout: 30_000 });
    return id;
  });

  if (gallery) {
    for (const [route, name] of [
      ["/queue", "queue"],
      ["/dashboard", "dashboard"],
      ["/eval", "eval"],
    ] as const) {
      await page.goto(`${web}${route}`, { waitUntil: "load" });
      await page.waitForTimeout(3000);
      await shot(page, name, name !== "queue");
    }
  }
} finally {
  await browser?.close();
}

for (const r of results)
  print(`${r.ok ? "PASS" : "FAIL"}  ${r.seconds.toFixed(1).padStart(5)}s  ${r.path}  ${r.note}`);
print(`screenshots: ${out}${gallery ? ` and ${media}` : ""}`);
process.exit(results.length === 3 && results.every((r) => r.ok) ? 0 : 1);
