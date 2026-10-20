/**
 * Isolated Week 1 acceptance harness.
 *
 * It starts a throwaway Postgres/pg-boss worker, the Fastify API, the real
 * demo-store Next app, and the real web Next app. PayPal remains the simulator;
 * no write endpoint is called. Run after `pnpm browser:install`.
 */
import { createRequire } from "node:module";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { defaultSources } from "@rebuttal/connectors";
import { createDb, type Db } from "@rebuttal/db";
import { seedDemoData } from "@rebuttal/db/seed";
import {
  DisputeSchema,
  createSimulatorClient,
  findRepoRoot,
  silentLogger,
  type Dispute,
} from "@rebuttal/paypal";
import { createTestDatabase, freePort, startEmbeddedPostgres } from "../packages/testkit/src/pg.js";
import { defaultDeps, ensureQueues, pgBossQueue, startWorker } from "@rebuttal/worker";
import { PgBoss } from "pg-boss";
import { buildApp } from "../apps/api/src/app.js";
import { apiConfigFromEnv } from "../apps/api/src/config.js";

interface BrowserPage {
  goto(url: string, options?: Record<string, unknown>): Promise<unknown>;
  waitForSelector(selector: string, options?: Record<string, unknown>): Promise<unknown>;
  screenshot(options: { path: string; fullPage?: boolean }): Promise<void>;
  close(): Promise<void>;
}

interface Browser {
  newPage(options?: Record<string, unknown>): Promise<BrowserPage>;
  close(): Promise<void>;
}

interface PlaywrightModule {
  chromium: { launch(options?: Record<string, unknown>): Promise<Browser> };
}

const root = findRepoRoot();
const fixedNow = new Date("2026-10-20T12:00:00.000Z");
const fixtureDir = join(root, "fixtures", "paypal");
const children: ChildProcess[] = [];

function log(message: string): void {
  console.log(`[week1] ${message}`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}

async function settle(task: Promise<unknown>, timeoutMs = 5_000): Promise<void> {
  await Promise.race([task.catch(() => undefined), sleep(timeoutMs)]);
}

async function waitForHttp(url: string, timeoutMs = 60_000): Promise<Response> {
  const deadline = Date.now() + timeoutMs;
  let lastError = "not attempted";
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return response;
      lastError = `${response.status}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await sleep(250);
  }
  throw new Error(`Timed out waiting for ${url} (${lastError})`);
}

async function waitFor<T>(
  label: string,
  read: () => Promise<T>,
  predicate: (value: T) => boolean,
  timeoutMs = 60_000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let last: T | undefined;
  while (Date.now() < deadline) {
    last = await read();
    if (predicate(last)) return last;
    await sleep(250);
  }
  throw new Error(`Timed out waiting for ${label}: ${JSON.stringify(last)}`);
}

function launchNext(appDir: string, port: number, env: NodeJS.ProcessEnv): ChildProcess {
  const nextBin = join(appDir, "node_modules", "next", "dist", "bin", "next");
  if (!existsSync(nextBin)) throw new Error(`Next binary is missing: ${nextBin}`);
  const { NODE_OPTIONS: _nodeOptions, ...parentEnv } = process.env;
  const child = spawn(
    process.execPath,
    [nextBin, "dev", "--webpack", "--hostname", "127.0.0.1", "--port", String(port)],
    {
      cwd: appDir,
      env: { ...parentEnv, ...env, PORT: String(port) },
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    },
  );
  const report = (chunk: Buffer) => {
    const line = chunk.toString().trim();
    if (line) log(line.slice(-240));
  };
  child.stdout?.on("data", report);
  child.stderr?.on("data", report);
  children.push(child);
  return child;
}

function freshDispute(templateName: string, id: string): Dispute {
  const template = DisputeSchema.parse(
    JSON.parse(readFileSync(join(fixtureDir, `dispute-${templateName}.json`), "utf8")),
  );
  return {
    ...template,
    dispute_id: id,
    create_time: fixedNow.toISOString(),
    update_time: fixedNow.toISOString(),
    seller_response_due_date: new Date(fixedNow.getTime() + 96 * 60 * 60_000).toISOString(),
    messages: (template.messages ?? []).map((message) => ({
      ...message,
      time_posted: fixedNow.toISOString(),
    })),
    links: [],
  };
}

async function postWebhook(apiOrigin: string, dispute: Dispute, eventId: string): Promise<Response> {
  return fetch(`${apiOrigin}/webhooks/paypal`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      id: eventId,
      event_version: "1.0",
      create_time: fixedNow.toISOString(),
      resource_type: "dispute",
      event_type: "CUSTOMER.DISPUTE.CREATED",
      summary: `Week 1 ${dispute.dispute_id}`,
      resource: dispute,
    }),
  });
}

async function main(): Promise<void> {
  const databaseDir = await mkdtemp(join(tmpdir(), "rebuttal-week1-pg-"));
  await mkdir(join(root, "storage", "test-output"), { recursive: true });
  const runDir = await mkdtemp(join(root, "storage", "test-output", "week1-"));
  const simulatorState = join(runDir, "simulator-state.json");
  const evidenceDir = join(runDir, "evidence");
  await mkdir(evidenceDir, { recursive: true });
  const pg = await startEmbeddedPostgres({ port: await freePort(), databaseDir });
  const database = await createTestDatabase(pg.adminUrl);
  const db: Db = createDb(database.url);
  let boss: PgBoss | undefined;
  let api: Awaited<ReturnType<typeof buildApp>> | undefined;
  let browser: Browser | undefined;

  try {
    await seedDemoData(db, fixedNow);
    const storePort = await freePort();
    const apiPort = await freePort();
    const webPort = await freePort();
    const storeOrigin = `http://127.0.0.1:${storePort}`;
    const apiOrigin = `http://127.0.0.1:${apiPort}`;
    const webOrigin = `http://127.0.0.1:${webPort}`;
    const commonEnv = {
      NODE_ENV: "development",
      DATABASE_URL: database.url,
      SIMULATOR: "1",
      API_TOKEN: "week1-api",
      STORE_API_TOKEN: "week1-store",
      STORE_SOURCE: "http",
      STORE_API_URL: storeOrigin,
      STORE_WEB_URL: storeOrigin,
      EVIDENCE_STORAGE_DIR: evidenceDir,
      STORE_ASSETS_DIR: join(root, "apps", "demo-store", "public"),
      POLL_DISABLED: "1",
    };

    launchNext(join(root, "apps", "demo-store"), storePort, commonEnv);
    await waitForHttp(`${storeOrigin}/p/legacy-waxed-canvas-jacket`);
    const storeLookup = await fetch(`${storeOrigin}/api/orders/lookup?capture=7MC82044LD0067890`, {
      headers: { authorization: "Bearer week1-store" },
    });
    if (!storeLookup.ok) throw new Error(`demo-store lookup failed: ${storeLookup.status}`);
    log("real demo-store HTTP API is ready");

    const simulator = createSimulatorClient({
      fixturesDir: fixtureDir,
      stateFile: simulatorState,
      now: () => fixedNow,
    });
    log("starting pg-boss");
    boss = new PgBoss({ connectionString: database.url, application_name: "rebuttal-week1" });
    await boss.start();
    log("pg-boss started; installing handlers");
    await ensureQueues(boss);
    log("queues installed; registering worker handlers");
    const queue = pgBossQueue(boss);
    const workerEnv = { ...process.env, ...commonEnv };
    await startWorker(
      boss,
      defaultDeps({
        db,
        paypal: simulator,
        queue,
        log: silentLogger,
        sources: defaultSources(workerEnv),
        now: () => fixedNow,
      }),
      { pollCron: false, pollingIntervalSeconds: 0.5 },
    );
    log("worker handlers installed; starting Fastify");

    api = await buildApp(
      {
        db,
        paypal: simulator,
        queue,
        config: {
          ...apiConfigFromEnv({ ...commonEnv, PORT: String(apiPort), WEB_ORIGIN: webOrigin }),
          apiToken: "week1-api",
          evidenceStorageDir: evidenceDir,
        },
        checkQueue: async () => {},
      },
      { logger: false },
    );
    await api.listen({ port: apiPort, host: "127.0.0.1" });
    log(`Fastify listening on ${apiOrigin}`);
    await waitForHttp(`${apiOrigin}/healthz`);

    launchNext(join(root, "apps", "web"), webPort, {
      ...commonEnv,
      API_URL: apiOrigin,
      API_TOKEN: "week1-api",
      WEB_ORIGIN: webOrigin,
    });
    await waitForHttp(`${webOrigin}/queue`);
    log("real Fastify and Next web HTTP surfaces are ready");

    const changedListing = freshDispute("not-as-described", "WEEK1-CHANGED-LISTING");
    const digital = freshDispute("unauthorised", "WEEK1-DIGITAL");
    if (await db.case.count({ where: { paypalDisputeId: changedListing.dispute_id } }))
      throw new Error("target case existed before webhook");
    simulator.sim.createDispute(changedListing);
    simulator.sim.createDispute(digital);
    const eventId = `WH-WEEK1-${randomUUID()}`;
    const first = await postWebhook(apiOrigin, changedListing, eventId);
    if (!first.ok) throw new Error(`created webhook failed: ${first.status}`);
    const duplicate = await postWebhook(apiOrigin, changedListing, eventId);
    if (!duplicate.ok) throw new Error(`duplicate webhook failed: ${duplicate.status}`);
    const digitalEvent = await postWebhook(apiOrigin, digital, `WH-WEEK1-${randomUUID()}`);
    if (!digitalEvent.ok) throw new Error(`digital webhook failed: ${digitalEvent.status}`);

    const changedCase = await waitFor(
      "changed-listing evidence and triage",
      () =>
        db.case.findUnique({
          where: { paypalDisputeId: changedListing.dispute_id },
          include: { evidence: true, decisions: true, actions: true },
        }),
      (row) =>
        !!row &&
        row.evidence.some((item) => item.source === "storefront" && item.filePath) &&
        row.decisions.length > 0,
    );
    if (!changedCase) throw new Error("changed-listing case was not created");
    const changedEvidence = changedCase.evidence.map((item) => ({
      type: item.type,
      filePath: item.filePath,
      data: item.data as Record<string, unknown>,
    }));
    const listing = changedEvidence.find((item) => item.data.kind === "listing_snapshot");
    const diff = changedEvidence.find((item) => item.data.kind === "listing_diff");
    if (!listing?.filePath) throw new Error("historical listing screenshot was not captured");
    if (!diff || JSON.stringify(diff.data.changedFields) !== JSON.stringify(["title", "description"]))
      throw new Error("listing diff did not identify title and description changes");
    const fileEvidence = changedCase.evidence.find((item) => item.filePath);
    if (!fileEvidence) throw new Error("no file-backed evidence was stored");
    const evidenceFile = await fetch(
      `${apiOrigin}/cases/${encodeURIComponent(changedCase.id)}/evidence/${encodeURIComponent(fileEvidence.id)}/file`,
      { headers: { authorization: "Bearer week1-api" } },
    );
    if (!evidenceFile.ok || !evidenceFile.headers.get("content-type")?.startsWith("image/png"))
      throw new Error(`evidence file proxy failed: ${evidenceFile.status}`);
    if (changedCase.actions?.length) throw new Error("Week 1 target unexpectedly created a PayPal Action");

    const digitalCase = await waitFor(
      "digital access evidence",
      () =>
        db.case.findUnique({
          where: { paypalDisputeId: digital.dispute_id },
          include: { evidence: true, decisions: true },
        }),
      (row) => !!row && row.evidence.some((item) => (item.data as { kind?: string }).kind === "access_log"),
    );
    if (!digitalCase) throw new Error("digital case was not created");

    const queueResponse = await fetch(
      `${webOrigin}/api/rebuttal/cases?q=${encodeURIComponent(changedListing.dispute_id)}`,
    );
    const queueBody: unknown = await queueResponse.json();
    if (
      !queueResponse.ok ||
      !Array.isArray(queueBody) ||
      !queueBody.some(
        (row: unknown) =>
          typeof row === "object" &&
          row !== null &&
          "paypalDisputeId" in row &&
          row.paypalDisputeId === changedListing.dispute_id,
      )
    )
      throw new Error("web queue proxy did not expose the webhook-created case");

    const playwright = createRequire(join(root, "packages", "connectors", "package.json"))(
      "playwright",
    ) as PlaywrightModule;
    browser = await playwright.chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    const screenshotDir = join(root, "storage", "test-output", "week1");
    await mkdir(screenshotDir, { recursive: true });
    await page.goto(`${webOrigin}/queue?q=${encodeURIComponent(changedListing.dispute_id)}`, {
      waitUntil: "networkidle",
    });
    await page.waitForSelector("text=Not as described", { timeout: 20_000 });
    await page.screenshot({ path: join(screenshotDir, "queue.png"), fullPage: true });
    await page.goto(`${webOrigin}/cases/${changedCase.id}`, { waitUntil: "networkidle" });
    await page.waitForSelector("text=Evidence checklist", { timeout: 20_000 });
    await page.screenshot({ path: join(screenshotDir, "case-detail.png"), fullPage: true });
    await page.close();

    const webhookCount = await db.webhookEvent.count({ where: { paypalEventId: eventId } });
    const actionCount = await db.action.count({ where: { caseId: changedCase.id } });
    const evidenceCount = await db.evidenceItem.count({ where: { caseId: changedCase.id } });
    const summary = {
      changedCaseId: changedCase.id,
      digitalCaseId: digitalCase.id,
      webhookRowsForReplay: webhookCount,
      evidenceCount,
      actionCount,
      listingSnapshotId: listing.data.snapshotId,
      diffChangedFields: diff.data.changedFields,
      screenshots: [join(screenshotDir, "queue.png"), join(screenshotDir, "case-detail.png")],
    };
    await writeFile(
      join(root, "storage", "test-output", "week1", "summary.json"),
      JSON.stringify(summary, null, 2),
    );
    log(`PASS ${JSON.stringify(summary)}`);
  } finally {
    if (browser) await settle(browser.close());
    if (api) await settle(api.close());
    if (boss) await settle(boss.stop({ graceful: false, timeout: 1_000 }));
    await settle(db.$disconnect());
    await settle(database.drop());
    await settle(pg.stop());
    await settle(rm(databaseDir, { recursive: true, force: true }));
    for (const child of children.reverse()) {
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGTERM");
    }
    await sleep(500);
    for (const child of children)
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
