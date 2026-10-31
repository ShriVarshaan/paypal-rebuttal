import { randomBytes } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_POLICY } from "@rebuttal/core";
import { createDb, type Db } from "@rebuttal/db";
import { createSimulatorClient } from "@rebuttal/paypal";
import { createTestDatabase } from "@rebuttal/testkit";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, inject, it } from "vitest";
import { buildApp } from "../src/app.js";
import { apiConfigFromEnv } from "../src/config.js";
import type { ConnectionChecks } from "../src/routes/onboarding.js";
import { credentialsKeyFromEnv, maskId, openSecret, sealSecret } from "../src/secrets.js";

const key = randomBytes(32);
let db: Db;
let drop: () => Promise<void>;
let api: FastifyInstance;
const sent: { name: string; data: object }[] = [];
let checks: ConnectionChecks;
const headers = { authorization: "Bearer t" };

beforeAll(async () => {
  const t = await createTestDatabase(inject("pgAdminUrl"));
  db = createDb(t.url);
  drop = t.drop;
  api = await buildApp(
    {
      db,
      paypal: createSimulatorClient({
        stateFile: join(mkdtempSync(join(tmpdir(), "rebuttal-onb-")), "s.json"),
      }),
      queue: { send: async (name, data) => (sent.push({ name, data }), "job"), cancel: async () => {} },
      config: { ...apiConfigFromEnv({}), apiToken: "t", credentialsKey: key },
      checkQueue: async () => {},
      connectionChecks: { paypal: (c) => checks.paypal(c), store: (u, t) => checks.store(u, t) },
    },
    { logger: false },
  );
});
afterAll(async () => {
  await api?.close();
  await db?.$disconnect();
  await drop?.();
});
beforeEach(async () => {
  sent.length = 0;
  await db.$executeRawUnsafe(`TRUNCATE "Connection", "Policy" CASCADE`);
  checks = { paypal: async () => ({ mode: "sandbox" }), store: async () => ({ products: 13 }) };
});

const post = (url: string, payload: object) => api.inject({ method: "POST", url, headers, payload });

describe("secrets", () => {
  it("round-trips, and detects a wrong key or a tampered ciphertext", () => {
    const sealed = sealSecret("s3cret", key);
    expect(sealed.startsWith("v1:")).toBe(true);
    expect(sealed).not.toContain("s3cret");
    expect(openSecret(sealed, key)).toBe("s3cret");
    expect(() => openSecret(sealed, randomBytes(32))).toThrow();
    const raw = Buffer.from(sealed.slice(3), "base64");
    raw[raw.length - 1]! ^= 1;
    expect(() => openSecret(`v1:${raw.toString("base64")}`, key)).toThrow();
    expect(maskId("AbCdEfGh12345678wxyz")).toBe("AbCd…wxyz");
  });

  it("reads CREDENTIALS_KEY as base64 or hex and rejects other lengths", () => {
    expect(credentialsKeyFromEnv({ CREDENTIALS_KEY: key.toString("base64") })?.equals(key)).toBe(true);
    expect(credentialsKeyFromEnv({ CREDENTIALS_KEY: key.toString("hex") })?.equals(key)).toBe(true);
    expect(credentialsKeyFromEnv({})).toBeNull();
    expect(() => credentialsKeyFromEnv({ CREDENTIALS_KEY: "short" })).toThrow();
  });
});

describe("onboarding", () => {
  it("stores PayPal credentials encrypted and never returns them", async () => {
    const r = await post("/onboarding/paypal", {
      clientId: "AbCdEfGh-sandbox-client",
      clientSecret: "EFgh-secret-value-123",
    });
    expect(r.json()).toMatchObject({ ok: true, mode: "sandbox" });
    const row = await db.connection.findFirstOrThrow({ where: { kind: "paypal" } });
    expect(row.status).toBe("VERIFIED");
    expect(row.secretCiphertext).not.toContain("EFgh-secret-value-123");
    expect(JSON.parse(openSecret(row.secretCiphertext!, key))).toMatchObject({
      clientSecret: "EFgh-secret-value-123",
    });
    const state = (await api.inject({ method: "GET", url: "/onboarding", headers })).json();
    expect(JSON.stringify(state)).not.toContain("EFgh-secret-value-123");
    expect(state.paypal).toMatchObject({
      status: "VERIFIED",
      hasSecret: true,
      config: { clientIdHint: "AbCd…ient" },
    });
  });

  it("reports PayPal's refusal and records the failure", async () => {
    checks.paypal = async () => {
      throw new Error("invalid_client");
    };
    const r = await post("/onboarding/paypal", {
      clientId: "AbCdEfGh-sandbox-client",
      clientSecret: "wrong-secret-value",
    });
    expect(r.statusCode).toBe(422);
    expect(r.json().error).toContain("invalid_client");
    expect((await db.connection.findFirstOrThrow({ where: { kind: "paypal" } })).status).toBe("FAILED");
  });

  it("checks the store URL, saves the policy and runs the first sync", async () => {
    expect((await post("/onboarding/store", { url: "ftp://store" })).statusCode).toBe(400);
    expect(
      (await post("/onboarding/store", { url: "http://127.0.0.1:3002", token: "store-token" })).json(),
    ).toMatchObject({
      ok: true,
      products: 13,
    });
    expect((await post("/onboarding/policy", { policy: DEFAULT_POLICY })).json()).toEqual({ ok: true });
    const sync = await post("/onboarding/sync", {});
    expect(sync.json().found).toBeGreaterThan(0);
    expect(sent.every((s) => s.name === "dispute.sync")).toBe(true);
    expect(sent).toHaveLength(sync.json().found);
    expect((await db.merchant.findUniqueOrThrow({ where: { id: "default" } })).onboardedAt).not.toBeNull();
  });
});
