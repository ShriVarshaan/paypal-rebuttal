import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDb, type Db } from "@rebuttal/db";
import {
  buildVerifyBody,
  createSimulatorClient,
  type PayPalClient,
  type VerifyWebhookInput,
} from "@rebuttal/paypal";
import { createTestDatabase } from "@rebuttal/testkit";
import type { JobQueue } from "@rebuttal/worker";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { inject } from "vitest";
import { buildApp } from "../src/app.js";
import { apiConfigFromEnv, type ApiConfig } from "../src/config.js";

const created = readFileSync(
  join(import.meta.dirname, "../../../fixtures/webhooks/dispute-created.json"),
  "utf8",
);

const SIGNED = {
  "content-type": "application/json",
  "paypal-transmission-id": "tx-1",
  "paypal-transmission-time": "2026-10-21T10:00:00Z",
  "paypal-cert-url": "https://api.sandbox.paypal.com/v1/notifications/certs/CERT-1",
  "paypal-auth-algo": "SHA256withRSA",
  "paypal-transmission-sig": "c2ln",
};

let db: Db;
let drop: () => Promise<void>;
const sent: { name: string; data: object }[] = [];
const queue: JobQueue = {
  send: async (name, data) => (sent.push({ name, data }), "job"),
  cancel: async () => {},
};
const verifyCalls: VerifyWebhookInput[] = [];
let verifyResult = true;

function sandboxLikeClient(): PayPalClient {
  const sim = createSimulatorClient({
    stateFile: join(mkdtempSync(join(tmpdir(), "rebuttal-api-")), "state.json"),
  });
  return {
    ...sim,
    mode: "sandbox",
    webhooks: {
      verifySignature: async (input) => {
        verifyCalls.push(input);
        return verifyResult;
      },
    },
  };
}

const baseConfig: ApiConfig = { ...apiConfigFromEnv({}), webhookId: "WH-ID", apiToken: "secret-token" };

async function app(
  overrides: Partial<ApiConfig> = {},
  paypal: PayPalClient = sandboxLikeClient(),
): Promise<FastifyInstance> {
  return buildApp(
    { db, paypal, queue, config: { ...baseConfig, ...overrides }, checkQueue: async () => {} },
    { logger: false },
  );
}

beforeAll(async () => {
  const t = await createTestDatabase(inject("pgAdminUrl"));
  db = createDb(t.url);
  drop = t.drop;
});
afterAll(async () => {
  await db.$disconnect();
  await drop();
});
beforeEach(async () => {
  await db.$executeRawUnsafe(`TRUNCATE "WebhookEvent", "Decision", "Case" CASCADE`);
  sent.length = 0;
  verifyCalls.length = 0;
  verifyResult = true;
});

describe("POST /webhooks/paypal", () => {
  it("verifies against the raw body, stores the event and enqueues a sync", async () => {
    const a = await app();
    const res = await a.inject({
      method: "POST",
      url: "/webhooks/paypal",
      headers: SIGNED,
      payload: created,
    });
    expect(res.statusCode).toBe(200);
    expect(verifyCalls[0]).toMatchObject({ rawBody: created, webhookId: "WH-ID" });
    const row = await db.webhookEvent.findFirstOrThrow();
    expect(row).toMatchObject({
      eventType: "CUSTOMER.DISPUTE.CREATED",
      resourceId: "PP-D-90001",
      verified: true,
    });
    expect(row.processedAt).not.toBeNull();
    expect(sent).toEqual([{ name: "dispute.sync", data: { disputeId: "PP-D-90001" } }]);
  });

  it("the same webhook delivered 5 times is stored and enqueued once", async () => {
    const a = await app();
    const codes = [];
    for (let i = 0; i < 5; i++)
      codes.push(
        (await a.inject({ method: "POST", url: "/webhooks/paypal", headers: SIGNED, payload: created }))
          .statusCode,
      );
    expect(codes).toEqual([200, 200, 200, 200, 200]);
    expect(await db.webhookEvent.count()).toBe(1);
    expect(sent).toHaveLength(1);
  });

  it("a redelivery finishes an event whose first delivery failed to enqueue", async () => {
    const a = await app();
    const original = queue.send;
    queue.send = async () => {
      throw new Error("queue down");
    };
    const first = await a.inject({
      method: "POST",
      url: "/webhooks/paypal",
      headers: SIGNED,
      payload: created,
    });
    queue.send = original;
    expect(first.statusCode).toBe(500);
    const retry = await a.inject({
      method: "POST",
      url: "/webhooks/paypal",
      headers: SIGNED,
      payload: created,
    });
    expect(retry.statusCode).toBe(200);
    expect(sent).toEqual([{ name: "dispute.sync", data: { disputeId: "PP-D-90001" } }]);
    expect((await db.webhookEvent.findFirstOrThrow()).processedAt).not.toBeNull();
  });

  it("rejects a bad signature and stores nothing", async () => {
    verifyResult = false;
    const res = await (
      await app()
    ).inject({ method: "POST", url: "/webhooks/paypal", headers: SIGNED, payload: created });
    expect(res.statusCode).toBe(400);
    expect(await db.webhookEvent.count()).toBe(0);
    expect(sent).toHaveLength(0);
  });

  it("rejects deliveries without PayPal's signature headers", async () => {
    // buildVerifyBody is where the real client checks the headers.
    const realVerify: PayPalClient = {
      ...sandboxLikeClient(),
      webhooks: { verifySignature: async (input) => (buildVerifyBody(input), true) },
    };
    const res = await (
      await app({}, realVerify)
    ).inject({
      method: "POST",
      url: "/webhooks/paypal",
      headers: { "content-type": "application/json" },
      payload: created,
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/paypal-/);
  });

  it("with WEBHOOK_SKIP_VERIFY, accepts unsigned events but marks them unverified", async () => {
    const res = await (
      await app({ skipWebhookVerify: true })
    ).inject({
      method: "POST",
      url: "/webhooks/paypal",
      headers: { "content-type": "application/json" },
      payload: created,
    });
    expect(res.statusCode).toBe(200);
    expect(verifyCalls).toHaveLength(0);
    expect((await db.webhookEvent.findFirstOrThrow()).verified).toBe(false);
  });

  it("refuses to start with the verify bypass in production", () => {
    expect(() =>
      apiConfigFromEnv({
        NODE_ENV: "production",
        WEBHOOK_SKIP_VERIFY: "1",
        API_TOKEN: "x",
        PAYPAL_WEBHOOK_ID: "y",
      }),
    ).toThrow(/not allowed/);
    expect(() => apiConfigFromEnv({ NODE_ENV: "production", PAYPAL_WEBHOOK_ID: "y" })).toThrow(/API_TOKEN/);
  });

  it("answers 400 for malformed JSON", async () => {
    const res = await (
      await app()
    ).inject({ method: "POST", url: "/webhooks/paypal", headers: SIGNED, payload: "{nope" });
    expect(res.statusCode).toBe(400);
  });
});

describe("REST routes", () => {
  async function seedDecision() {
    const raw = JSON.parse(
      readFileSync(join(import.meta.dirname, "../../../fixtures/paypal/dispute-not-received.json"), "utf8"),
    );
    const c = await db.case.create({
      data: {
        paypalDisputeId: raw.dispute_id,
        reason: raw.reason,
        status: raw.status,
        stage: raw.dispute_life_cycle_stage,
        amountCents: 8900,
        currency: "USD",
        disputedTransactions: [],
        messages: [],
        raw,
        paypalCreatedAt: new Date(raw.create_time),
        paypalUpdatedAt: new Date(raw.update_time),
      },
    });
    return db.decision.create({ data: { caseId: c.id, option: "FIGHT", note: "Delivered" } });
  }

  it("requires the bearer token", async () => {
    const a = await app();
    expect((await a.inject({ method: "GET", url: "/cases" })).statusCode).toBe(401);
    expect(
      (await a.inject({ method: "GET", url: "/cases", headers: { authorization: "Bearer wrong" } }))
        .statusCode,
    ).toBe(401);
    expect(
      (await a.inject({ method: "GET", url: "/cases", headers: { authorization: "Bearer secret-token" } }))
        .statusCode,
    ).toBe(200);
  });

  it("approve hands the decision to the executor exactly once", async () => {
    const d = await seedDecision();
    const a = await app();
    const headers = { authorization: "Bearer secret-token" };
    const first = await a.inject({
      method: "POST",
      url: `/decisions/${d.id}/approve`,
      headers,
      payload: { approvedBy: "noah" },
    });
    expect(first.statusCode).toBe(200);
    expect(first.json()).toMatchObject({ status: "APPROVED", approvedBy: "noah" });
    expect(sent).toEqual([{ name: "action.execute", data: { decisionId: d.id } }]);
    expect((await a.inject({ method: "POST", url: `/decisions/${d.id}/approve`, headers })).statusCode).toBe(
      409,
    );
    expect((await a.inject({ method: "POST", url: `/decisions/nope/approve`, headers })).statusCode).toBe(
      404,
    );
    expect(sent).toHaveLength(1);
  });

  it("locks CORS to the web origin", async () => {
    const a = await app();
    const res = await a.inject({
      method: "OPTIONS",
      url: "/cases",
      headers: { origin: "https://evil.example.com", "access-control-request-method": "GET" },
    });
    expect(res.headers["access-control-allow-origin"]).not.toBe("https://evil.example.com");
    const ok = await a.inject({
      method: "OPTIONS",
      url: "/cases",
      headers: { origin: "http://localhost:3000", "access-control-request-method": "GET" },
    });
    expect(ok.headers["access-control-allow-origin"]).toBe("http://localhost:3000");
  });
});

describe("GET /healthz", () => {
  it("is 200 when db, queue and PayPal are up, 503 otherwise", async () => {
    expect((await (await app()).inject({ method: "GET", url: "/healthz" })).json()).toMatchObject({
      ok: true,
    });
    const broken = { ...sandboxLikeClient(), ping: async () => Promise.reject(new Error("token refused")) };
    const res = await (await app({}, broken)).inject({ method: "GET", url: "/healthz" });
    expect(res.statusCode).toBe(503);
    expect(res.json().checks.paypal).toMatchObject({ ok: false, error: "token refused" });
  });
});
