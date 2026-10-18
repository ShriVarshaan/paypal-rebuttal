import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createOfflineEasyPostSource, type EvidenceSource } from "@rebuttal/connectors";
import { createDb, type Db } from "@rebuttal/db";
import {
  createSimulatorClient,
  silentLogger,
  type PayPalClient,
  type SimulatorClient,
} from "@rebuttal/paypal";
import { createTestDatabase } from "@rebuttal/testkit";
import { afterAll, inject } from "vitest";
import { defaultDeps, type Deps } from "../src/deps.js";
import type { JobQueue, QueueName, SendOptions } from "../src/queues.js";

export const FIXTURES = join(import.meta.dirname, "../../../fixtures/paypal");
export const NOW = new Date("2026-10-20T12:00:00.000Z");

export interface Sent {
  id: string;
  name: QueueName;
  data: Record<string, unknown>;
  options: SendOptions;
}

export function recordingQueue(): JobQueue & {
  sent: Sent[];
  cancelled: string[];
  take(name: QueueName): Sent[];
} {
  const sent: Sent[] = [];
  const cancelled: string[] = [];
  let n = 0;
  return {
    sent,
    cancelled,
    async send(name, data, options = {}) {
      const id = `job-${++n}`;
      sent.push({ id, name, data: data as Record<string, unknown>, options });
      return id;
    },
    async cancel(_name, id) {
      cancelled.push(id);
    },
    /** Removes and returns the jobs sent to `name` so far. */
    take(name) {
      const picked = sent.filter((s) => s.name === name);
      for (const p of picked) sent.splice(sent.indexOf(p), 1);
      return picked;
    },
  };
}

export function newSimulator(): SimulatorClient {
  const dir = mkdtempSync(join(tmpdir(), "rebuttal-sim-"));
  return createSimulatorClient({
    fixturesDir: FIXTURES,
    stateFile: join(dir, "state.json"),
    now: () => clock.now,
  });
}

/** Mutable test clock shared by deps and the simulator. */
export const clock = { now: NOW };

export interface TestEnv {
  db: Db;
  deps: Deps;
  sim: SimulatorClient;
  queue: ReturnType<typeof recordingQueue>;
  /** Replace the PayPal client the jobs see (e.g. to inject faults). */
  usePayPal(p: PayPalClient): void;
}

/** One migrated database per test file; call at module level. */
export function setupTestEnv(sources: EvidenceSource[] = [createOfflineEasyPostSource(() => clock.now)]) {
  const env = {} as TestEnv;
  let drop: (() => Promise<void>) | undefined;

  const ready = (async () => {
    const tdb = await createTestDatabase(inject("pgAdminUrl"));
    drop = tdb.drop;
    env.db = createDb(tdb.url);
    env.sim = newSimulator();
    env.queue = recordingQueue();
    env.deps = defaultDeps({
      db: env.db,
      paypal: env.sim,
      queue: env.queue,
      log: silentLogger,
      sources,
      now: () => clock.now,
    });
    env.usePayPal = (p) => {
      env.deps.paypal = p;
    };
  })();

  afterAll(async () => {
    await env.db?.$disconnect();
    await drop?.();
  });

  /** Call in beforeEach: empty tables, a fresh simulator, an empty queue and the clock at NOW. */
  return async () => {
    await ready;
    await resetDb(env.db);
    clock.now = NOW;
    env.sim = newSimulator();
    env.deps.paypal = env.sim;
    env.queue.sent.length = 0;
    env.queue.cancelled.length = 0;
    return env;
  };
}

/** Deletes all rows so each test starts clean (faster than a new database). */
export async function resetDb(db: Db): Promise<void> {
  await db.$executeRawUnsafe(
    `TRUNCATE "Action", "Decision", "EvidencePack", "EvidenceItem", "CaseEvent", "Notification", "SlaJob", "Case", "WebhookEvent", "SyncCursor", "Policy", "AgentRun" CASCADE`,
  );
}
