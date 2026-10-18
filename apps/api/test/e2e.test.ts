// Simulator-mode end to end (`pnpm e2e:sim`): webhook → sync → enrich → gather →
// triage (B) → approve → provide-evidence → adjudicate → RESOLVED webhook → WON.
// Real pg-boss, real Postgres, the api and worker in one process; PayPal is the simulator.
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createOfflineEasyPostSource } from "@rebuttal/connectors";
import { createDb, type Db } from "@rebuttal/db";
import { createSimulatorClient, silentLogger, type SimulatorClient } from "@rebuttal/paypal";
import { createTestDatabase } from "@rebuttal/testkit";
import { QUEUES, defaultDeps, ensureQueues, pgBossQueue, startWorker } from "@rebuttal/worker";
import type { FastifyInstance } from "fastify";
import { PgBoss } from "pg-boss";
import { afterAll, beforeAll, expect, inject, it } from "vitest";
import { buildApp } from "../src/app.js";
import { apiConfigFromEnv } from "../src/config.js";

const FIXTURES = join(import.meta.dirname, "../../../fixtures");
let db: Db;
let boss: PgBoss;
let api: FastifyInstance;
let sim: SimulatorClient;
let drop: () => Promise<void>;

beforeAll(async () => {
  const t = await createTestDatabase(inject("pgAdminUrl"));
  drop = t.drop;
  db = createDb(t.url);
  sim = createSimulatorClient({
    fixturesDir: join(FIXTURES, "paypal"),
    stateFile: join(mkdtempSync(join(tmpdir(), "rebuttal-e2e-")), "state.json"),
  });
  boss = new PgBoss({ connectionString: t.url });
  await boss.start();
  await ensureQueues(boss);
  const queue = pgBossQueue(boss);
  await startWorker(
    boss,
    defaultDeps({ db, paypal: sim, queue, log: silentLogger, sources: [createOfflineEasyPostSource()] }),
    {
      pollCron: false,
      pollingIntervalSeconds: 0.5,
    },
  );
  api = await buildApp(
    {
      db,
      paypal: sim,
      queue,
      config: { ...apiConfigFromEnv({}), apiToken: "t" },
      checkQueue: async () => {},
    },
    { logger: false },
  );
}, 60_000);

afterAll(async () => {
  await api?.close();
  await boss?.stop({ graceful: false, timeout: 1000 });
  await db?.$disconnect();
  await drop?.();
});

const webhook = (file: string) =>
  api.inject({
    method: "POST",
    url: "/webhooks/paypal",
    headers: { "content-type": "application/json" },
    payload: readFileSync(join(FIXTURES, "webhooks", file), "utf8"),
  });

it(
  "not-received dispute: webhook → evidence → triage → approve → file → adjudicate → WON",
  { timeout: 60_000 },
  async () => {
    expect((await webhook("dispute-created.json")).statusCode).toBe(200);

    // sync → enrich → gather → triage run in the worker.
    await expect
      .poll(
        async () =>
          (await db.caseEvent.findMany({ where: { case: { paypalDisputeId: "PP-D-90001" } } })).map(
            (e) => e.type,
          ),
        { timeout: 20_000, interval: 250 },
      )
      .toEqual(["CREATED", "ENRICHED", "EVIDENCE_GATHERED", "TRIAGED", "DECISION_PROPOSED"]);
    const c = await db.case.findUniqueOrThrow({
      where: { paypalDisputeId: "PP-D-90001" },
      include: { evidence: true },
    });
    expect(c.evidence.map((e) => (e.data as { status: string }).status)).toEqual(["delivered"]);

    // Triage proposed FIGHT (9 is above the auto-file limit); C's pack job would build the PDF.
    const decision = await db.decision.findFirstOrThrow({ where: { caseId: c.id } });
    expect(decision).toMatchObject({ option: "FIGHT", status: "PROPOSED" });
    expect(c.state).toBe("AWAITING_APPROVAL");
    const pdf = join(mkdtempSync(join(tmpdir(), "rebuttal-pack-")), "pack.pdf");
    writeFileSync(pdf, Buffer.concat([Buffer.from("%PDF-1.7\n"), Buffer.alloc(4096)]));
    const pack = await db.evidencePack.create({
      data: {
        caseId: c.id,
        decisionId: decision.id,
        status: "PENDING",
        files: [{ path: pdf, evidenceType: "PROOF_OF_FULFILLMENT" }],
      },
    });

    const approve = await api.inject({
      method: "POST",
      url: `/decisions/${decision.id}/approve`,
      headers: { authorization: "Bearer t" },
    });
    expect(approve.statusCode).toBe(200);
    await expect
      .poll(async () => (await db.case.findUniqueOrThrow({ where: { id: c.id } })).state, { timeout: 15_000 })
      .toBe("FILING"); // waiting for the pack

    await db.evidencePack.update({ where: { id: pack.id }, data: { status: "READY" } });
    await boss.send(QUEUES.packReady, { packId: pack.id });
    await expect
      .poll(async () => (await db.case.findUniqueOrThrow({ where: { id: c.id } })).state, { timeout: 15_000 })
      .toBe("FILED");
    expect(sim.sim.state().disputes["PP-D-90001"]!.status).toBe("UNDER_REVIEW");

    // PayPal decides; its RESOLVED webhook arrives.
    await sim.disputes.adjudicate("PP-D-90001", "SELLER_FAVOR", "e2e-adjudicate");
    expect((await webhook("dispute-resolved.json")).statusCode).toBe(200);
    await expect
      .poll(async () => (await db.case.findUniqueOrThrow({ where: { id: c.id } })).state, { timeout: 15_000 })
      .toBe("WON");

    const actions = await db.action.findMany({ where: { caseId: c.id } });
    expect(actions.map((a) => [a.kind, a.status])).toEqual([["PROVIDE_EVIDENCE", "SUCCEEDED"]]);
    expect(await db.slaJob.count({ where: { caseId: c.id, status: "SCHEDULED" } })).toBe(0);
  },
);

it(
  "a cron-style poll job (data: null) syncs disputes no webhook announced",
  { timeout: 30_000 },
  async () => {
    await boss.send(QUEUES.disputePoll, null);
    await expect
      .poll(
        async () =>
          (await db.case.findMany({ select: { paypalDisputeId: true } }))
            .map((c) => c.paypalDisputeId)
            .sort(),
        { timeout: 20_000, interval: 250 },
      )
      .toEqual(["PP-D-90001", "PP-D-90002", "PP-D-90003"]);
  },
);
