import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CaseDetail } from "@rebuttal/core";
import { createDb, type Db } from "@rebuttal/db";
import { createSimulatorClient } from "@rebuttal/paypal";
import { createTestDatabase } from "@rebuttal/testkit";
import type { JobQueue } from "@rebuttal/worker";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, inject, it } from "vitest";
import { buildApp } from "../src/app.js";
import { apiConfigFromEnv } from "../src/config.js";

let db: Db;
let drop: () => Promise<void>;
let api: FastifyInstance;
const storage = mkdtempSync(join(tmpdir(), "rebuttal-api-storage-"));
const sent: { name: string; data: object }[] = [];
const queue: JobQueue = {
  send: async (name, data) => (sent.push({ name, data }), "job"),
  cancel: async () => {},
};
const headers = { authorization: "Bearer t" };

beforeAll(async () => {
  const t = await createTestDatabase(inject("pgAdminUrl"));
  db = createDb(t.url);
  drop = t.drop;
  const paypal = createSimulatorClient({
    stateFile: join(mkdtempSync(join(tmpdir(), "rebuttal-api-c-")), "s.json"),
  });
  api = await buildApp(
    {
      db,
      paypal,
      queue,
      config: { ...apiConfigFromEnv({}), apiToken: "t", evidenceStorageDir: storage },
      checkQueue: async () => {},
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
  await db.$executeRawUnsafe(
    `TRUNCATE "Action", "EvidencePack", "EvidenceItem", "Decision", "CaseEvent", "Notification", "Case" CASCADE`,
  );
});

async function seed(option: "FIGHT" | "OFFER" = "FIGHT") {
  const c = await db.case.create({
    data: {
      paypalDisputeId: "PP-D-90001",
      reason: "MERCHANDISE_OR_SERVICE_NOT_RECEIVED",
      status: "WAITING_FOR_SELLER_RESPONSE",
      stage: "INQUIRY",
      state: "AWAITING_APPROVAL",
      amountCents: 8900,
      currency: "USD",
      disputedTransactions: [],
      messages: [],
      raw: {},
      paypalCreatedAt: new Date("2026-10-15T09:12:44Z"),
      paypalUpdatedAt: new Date("2026-10-15T09:12:44Z"),
    },
  });
  const ev = await db.evidenceItem.create({
    data: {
      caseId: c.id,
      source: "easypost",
      type: "PROOF_OF_FULFILLMENT",
      title: "Tracking",
      dedupeKey: "t1",
      data: { trackingCode: "EZ1", carrier: "USPS", status: "delivered" },
      capturedAt: new Date("2026-10-15T10:00:00Z"),
    },
  });
  const d = await db.decision.create({
    data: {
      caseId: c.id,
      option,
      note: "Delivered (EX-1).",
      pWin: 0.72,
      ...(option === "OFFER" ? { offerType: "REFUND", offerAmountCents: 3900 } : {}),
      analysis: {
        engineVersion: "test",
        pWinModel: 0.72,
        pWin: 0.72,
        contributions: [],
        rationale: [],
        completeness: { score: 1, requiredMet: true, missingRequired: [], missingOptional: [] },
        ev: { fightCents: 5000, acceptCents: 0, offer: null },
        allowed: ["FIGHT", "OFFER", "ACCEPT"],
        chosen: option,
        llm: null,
        autonomy: { autoApprove: false, reasons: [] },
        exhibits: [{ exhibitId: "EX-1", evidenceId: ev.id, title: "Tracking", summary: "Delivered" }],
        usage: [],
      },
      narrative: {
        headline: "Delivered.",
        claims: [{ text: "USPS delivered it.", exhibits: ["EX-1"] }],
        source: "template",
        rejectedClaims: 0,
        needsReview: false,
        notesByType: { PROOF_OF_FULFILLMENT: "Delivered." },
      },
    },
  });
  return { c, d };
}

const post = (url: string, payload: object = {}) => api.inject({ method: "POST", url, headers, payload });
const events = async (caseId: string) =>
  (await db.caseEvent.findMany({ where: { caseId }, orderBy: { createdAt: "asc" } })).map((e) => e.type);

describe("approve", () => {
  it("records who approved and queues the executor; an existing pack is reused", async () => {
    const { c, d } = await seed();
    await db.evidencePack.create({ data: { caseId: c.id, decisionId: d.id, status: "READY", files: [] } });
    const r = await post(`/decisions/${d.id}/approve`, { approvedBy: "owner" });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ status: "APPROVED", approvedBy: "owner" });
    expect(sent).toEqual([{ name: "action.execute", data: { decisionId: d.id } }]);
    expect(await events(c.id)).toEqual(["DECISION_APPROVED"]);
  });
});

describe("reject", () => {
  it("needs a reason, then rejects with an audit event and retires the pack", async () => {
    const { c, d } = await seed();
    await db.evidencePack.create({ data: { caseId: c.id, decisionId: d.id, status: "READY", files: [] } });
    expect((await post(`/decisions/${d.id}/reject`, {})).statusCode).toBe(400);
    const r = await post(`/decisions/${d.id}/reject`, {
      by: "owner",
      reason: "Buyer already refunded by email",
    });
    expect(r.json()).toMatchObject({ status: "REJECTED", reason: "REJECTED_BY_SELLER" });
    const ev = await db.caseEvent.findFirstOrThrow({ where: { caseId: c.id, type: "DECISION_REJECTED" } });
    expect(ev.payload).toMatchObject({ by: "owner", reason: "Buyer already refunded by email" });
    expect((await db.evidencePack.findFirstOrThrow({ where: { decisionId: d.id } })).status).toBe(
      "SUPERSEDED",
    );
    expect((await post(`/decisions/${d.id}/reject`, { reason: "again" })).statusCode).toBe(409);
  });
});

describe("override", () => {
  it("switches FIGHT to an offer with a generated note and the reason in the audit trail", async () => {
    const { c, d } = await seed();
    expect(
      (await post(`/decisions/${d.id}/override`, { option: "OFFER", offerAmountCents: 2000 })).statusCode,
    ).toBe(400);
    const r = await post(`/decisions/${d.id}/override`, {
      by: "owner",
      option: "OFFER",
      offerType: "REFUND",
      offerAmountCents: 2000,
      reason: "Repeat customer; keep the relationship",
    });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ option: "OFFER", offerAmountCents: 2000, status: "PROPOSED" });
    expect(r.json().note).toContain("$20.00");
    expect(await events(c.id)).toEqual(["DECISION_EDITED", "DECISION_OVERRIDDEN"]);
    const ev = await db.caseEvent.findFirstOrThrow({ where: { caseId: c.id, type: "DECISION_OVERRIDDEN" } });
    expect(ev.payload).toMatchObject({
      from: "FIGHT",
      to: "OFFER",
      reason: "Repeat customer; keep the relationship",
    });
  });

  it("caps offers at the disputed amount", async () => {
    const { d } = await seed();
    const r = await post(`/decisions/${d.id}/override`, {
      option: "OFFER",
      offerAmountCents: 9999,
      reason: "test",
    });
    expect(r.statusCode).toBe(400);
  });

  it("rebuilds the pack when overriding to FIGHT", async () => {
    const { d } = await seed("OFFER");
    const r = await post(`/decisions/${d.id}/override`, { option: "FIGHT", reason: "Tracking is solid" });
    expect(r.json()).toMatchObject({ option: "FIGHT", offerAmountCents: null });
    expect(r.json().note).toContain("USPS delivered it");
    expect(sent).toEqual([{ name: "pack.build", data: { decisionId: d.id } }]);
  });

  it("regenerates the offer note when only the amount changes (PATCH)", async () => {
    const { d } = await seed("OFFER");
    const r = await api.inject({
      method: "PATCH",
      url: `/decisions/${d.id}`,
      headers,
      payload: { offerAmountCents: 2500 },
    });
    expect(r.json().note).toContain("$25.00");
  });
});

describe("narrative edits", () => {
  it("stores cited claims, rewrites the PayPal note and rebuilds the PDF", async () => {
    const { c, d } = await seed();
    const r = await api.inject({
      method: "PUT",
      url: `/decisions/${d.id}/narrative`,
      headers,
      payload: {
        by: "owner",
        headline: "Delivered and signed for.",
        claims: [{ text: "Signed by J. Doe.", exhibits: ["EX-1"] }],
      },
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().note).toContain("Signed by J. Doe. (EX-1)");
    expect(r.json().narrative).toMatchObject({
      headline: "Delivered and signed for.",
      notesByType: { PROOF_OF_FULFILLMENT: "Delivered." },
    });
    expect(sent).toEqual([{ name: "pack.build", data: { decisionId: d.id } }]);
    expect(await events(c.id)).toEqual(["NARRATIVE_EDITED"]);
  });

  it("refuses claims without citations or citing unknown exhibits", async () => {
    const { d } = await seed();
    const put = (claims: object[]) =>
      api.inject({
        method: "PUT",
        url: `/decisions/${d.id}/narrative`,
        headers,
        payload: { headline: "h", claims },
      });
    expect((await put([{ text: "no cite", exhibits: [] }])).statusCode).toBe(400);
    const unknown = await put([{ text: "x", exhibits: ["EX-9"] }]);
    expect(unknown.statusCode).toBe(400);
    expect(unknown.json().error).toContain("EX-9");
  });
});

describe("packs in the case detail and the PDF route", () => {
  it("serves the preview from storage and refuses paths outside it", async () => {
    const { c, d } = await seed();
    const dir = join(storage, c.id, "packs", "p1");
    mkdirSync(dir, { recursive: true });
    const preview = join(dir, "evidence-pack.pdf");
    writeFileSync(preview, "%PDF-1.7\n%test\n");
    const pack = await db.evidencePack.create({
      data: {
        caseId: c.id,
        decisionId: d.id,
        status: "READY",
        previewPath: preview,
        totalBytes: 16,
        notes: "Profile standard exceeded\nsecond",
        files: [
          {
            name: "01-proof-of-fulfillment.pdf",
            path: preview,
            evidenceType: "PROOF_OF_FULFILLMENT",
            sizeBytes: 16,
            pages: 2,
            exhibits: ["EX-1"],
          },
        ],
        exhibits: [
          {
            exhibitId: "EX-1",
            evidenceId: "e",
            title: "Carrier tracking",
            evidenceType: "PROOF_OF_FULFILLMENT",
          },
        ],
      },
    });
    const file = await api.inject({ method: "GET", url: `/packs/${pack.id}/file`, headers });
    expect(file.statusCode).toBe(200);
    expect(file.headers["content-type"]).toBe("application/pdf");
    expect(file.headers["content-disposition"]).toContain("evidence-pack-PP-D-90001.pdf");
    expect(
      (
        await api.inject({
          method: "GET",
          url: `/packs/${pack.id}/file?name=01-proof-of-fulfillment.pdf`,
          headers,
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (await api.inject({ method: "GET", url: `/packs/${pack.id}/file?name=nope.pdf`, headers })).statusCode,
    ).toBe(404);

    const outside = join(mkdtempSync(join(tmpdir(), "rebuttal-outside-")), "x.pdf");
    writeFileSync(outside, "%PDF");
    await db.evidencePack.update({ where: { id: pack.id }, data: { previewPath: outside } });
    expect((await api.inject({ method: "GET", url: `/packs/${pack.id}/file`, headers })).statusCode).toBe(
      403,
    );

    const detail = CaseDetail.parse(
      (await api.inject({ method: "GET", url: `/cases/${c.id}`, headers })).json(),
    );
    expect(detail.pack).toMatchObject({
      id: pack.id,
      status: "READY",
      hasPreview: true,
      warnings: ["Profile standard exceeded", "second"],
      files: [{ name: "01-proof-of-fulfillment.pdf", pages: 2, exhibits: ["EX-1"] }],
    });
  });

  it("surfaces a failed action's message and PayPal debug id", async () => {
    const { c, d } = await seed();
    await db.action.create({
      data: {
        caseId: c.id,
        decisionId: d.id,
        kind: "PROVIDE_EVIDENCE",
        endpoint: "POST /v1/customer/disputes/{id}/provide-evidence",
        idempotencyKey: "k1",
        status: "FAILED",
        attempts: 2,
        error: { name: "PayPalError", message: "UNPROCESSABLE_ENTITY", debugId: "dbg-123" },
      },
    });
    const detail = CaseDetail.parse(
      (await api.inject({ method: "GET", url: `/cases/${c.id}`, headers })).json(),
    );
    expect(detail.actions[0]).toMatchObject({
      status: "FAILED",
      debugId: "dbg-123",
      errorMessage: "UNPROCESSABLE_ENTITY",
      attempts: 2,
    });
  });
});

describe("notifications", () => {
  it("marks one or all as read", async () => {
    const a = await db.notification.create({ data: { kind: "X", level: "info", message: "a" } });
    await db.notification.create({ data: { kind: "X", level: "info", message: "b" } });
    expect((await post(`/notifications/${a.id}/read`)).statusCode).toBe(200);
    expect((await api.inject({ method: "GET", url: "/notifications", headers })).json()).toHaveLength(1);
    expect((await post("/notifications/read-all")).json()).toEqual({ read: 1 });
  });
});

describe("buyer messages", () => {
  it("records one SEND_MESSAGE action per draft and queues the send", async () => {
    const { c } = await seed();
    const body = { message: "Hi, tracking shows delivery on Oct 5.", requestId: "draft-0001-abcd" };
    const first = await post(`/cases/${c.id}/messages`, body);
    const again = await post(`/cases/${c.id}/messages`, body);
    expect(first.statusCode).toBe(202);
    expect(again.json().actionId).toBe(first.json().actionId);
    const actions = await db.action.findMany({ where: { caseId: c.id, kind: "SEND_MESSAGE" } });
    expect(actions).toHaveLength(1);
    expect(actions[0]!.idempotencyKey).toBe(`${c.id}:message:draft-0001-abcd`);
    expect(sent.map((s) => s.name)).toEqual(["message.send", "message.send"]);
    expect(
      (await post(`/cases/${c.id}/messages`, { message: "", requestId: "draft-0002-abcd" })).statusCode,
    ).toBe(400);
  });
});
