import { describe, expect, it, beforeEach } from "vitest";
import { sendBuyerMessage } from "../src/jobs/message.js";
import { syncDispute } from "../src/jobs/sync.js";
import { setupTestEnv, type TestEnv } from "./helpers.js";

const fresh = setupTestEnv();
let t: TestEnv;
beforeEach(async () => {
  t = await fresh();
});

async function queued(message = "Tracking shows delivery on Oct 5.") {
  const { caseId } = await syncDispute(t.deps, "PP-D-90001");
  return t.db.action.create({
    data: {
      caseId,
      kind: "SEND_MESSAGE",
      endpoint: "POST /v1/customer/disputes/{id}/send-message",
      idempotencyKey: `${caseId}:message:draft-1`,
      request: { message },
    },
  });
}

describe("message.send", () => {
  it("sends once with the action's idempotency key and records it", async () => {
    const action = await queued();
    expect(await sendBuyerMessage(t.deps, action.id, { retryCount: 0, retryLimit: 3 })).toEqual({
      status: "sent",
      actionId: action.id,
    });
    expect(await sendBuyerMessage(t.deps, action.id, { retryCount: 0, retryLimit: 3 })).toMatchObject({
      status: "skipped",
    });
    const calls = t.sim.sim.state().calls.filter((c) => c.endpoint.includes("send-message"));
    expect(calls.map((c) => c.idempotencyKey)).toEqual([action.idempotencyKey]);
    expect((await t.db.action.findUniqueOrThrow({ where: { id: action.id } })).status).toBe("SUCCEEDED");
    expect(await t.db.message.count({ where: { caseId: action.caseId, sender: "SELLER" } })).toBe(1);
    expect(await t.db.caseEvent.count({ where: { caseId: action.caseId, type: "MESSAGE_SENT" } })).toBe(1);
  });

  it("records a permanent PayPal failure and tells the seller", async () => {
    const action = await queued();
    t.usePayPal({
      ...t.sim,
      disputes: {
        ...t.sim.disputes,
        sendMessage: async () => {
          throw new Error("dispute is closed");
        },
      },
    });
    const r = await sendBuyerMessage(t.deps, action.id, { retryCount: 0, retryLimit: 3 });
    expect(r).toMatchObject({ status: "failed", error: "dispute is closed" });
    expect(await t.db.notification.count({ where: { caseId: action.caseId, kind: "ACTION_FAILED" } })).toBe(
      1,
    );
  });
});
