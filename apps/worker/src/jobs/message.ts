import { PayPalError, isRetryable } from "@rebuttal/paypal";
import { json } from "../case-row.js";
import { PermanentJobError, type Deps } from "../deps.js";

export interface MessageAttempt {
  retryCount: number;
  retryLimit: number;
}

export type MessageJobResult =
  | { status: "sent"; actionId: string }
  | { status: "failed"; actionId: string; error: string }
  | { status: "skipped"; reason: string };

/**
 * message.send (C, Day 12): post the seller's message to the buyer through PayPal. The api
 * records the Action (with its idempotency key) before queueing, so a retry or a duplicate
 * job reuses the same PayPal-Request-Id and the buyer never gets the message twice.
 */
export async function sendBuyerMessage(
  deps: Deps,
  actionId: string,
  attempt: MessageAttempt,
): Promise<MessageJobResult> {
  const action = await deps.db.action.findUnique({ where: { id: actionId }, include: { case: true } });
  if (!action) throw new PermanentJobError(`Action ${actionId} not found`);
  if (action.kind !== "SEND_MESSAGE") throw new PermanentJobError(`Action ${actionId} is ${action.kind}`);
  if (action.status === "SUCCEEDED") return { status: "skipped", reason: "already sent" };
  if (action.status === "FAILED") return { status: "skipped", reason: "previously failed" };
  const message = (action.request as { message?: unknown } | null)?.message;
  if (typeof message !== "string" || !message)
    throw new PermanentJobError(`Action ${actionId} has no message`);

  await deps.db.action.update({
    where: { id: action.id },
    data: { status: "IN_FLIGHT", attempts: { increment: 1 } },
  });
  try {
    const response = await deps.paypal.disputes.sendMessage(
      action.case.paypalDisputeId,
      { message },
      action.idempotencyKey,
    );
    const sentAt = deps.now();
    await deps.db.$transaction([
      deps.db.action.update({
        where: { id: action.id },
        data: { status: "SUCCEEDED", response: json(response ?? {}), error: undefined, completedAt: sentAt },
      }),
      deps.db.message.upsert({
        where: {
          caseId_source_dedupeKey: {
            caseId: action.caseId,
            source: "rebuttal",
            dedupeKey: action.idempotencyKey,
          },
        },
        create: {
          caseId: action.caseId,
          source: "rebuttal",
          dedupeKey: action.idempotencyKey,
          sender: "SELLER",
          channel: "paypal",
          text: message,
          sentAt,
        },
        update: {},
      }),
      deps.db.caseEvent.create({
        data: {
          caseId: action.caseId,
          type: "MESSAGE_SENT",
          payload: json({ actionId: action.id, message }),
        },
      }),
    ]);
    return { status: "sent", actionId: action.id };
  } catch (err) {
    const lastAttempt = attempt.retryCount >= attempt.retryLimit;
    const error =
      err instanceof PayPalError
        ? { name: err.name, message: err.message, status: err.status, debugId: err.debugId ?? null }
        : { name: "Error", message: err instanceof Error ? err.message : String(err) };
    if (isRetryable(err) && !lastAttempt) {
      await deps.db.action.update({
        where: { id: action.id },
        data: { status: "PENDING", error: json(error) },
      });
      throw err;
    }
    await deps.db.$transaction([
      deps.db.action.update({
        where: { id: action.id },
        data: { status: "FAILED", error: json(error), completedAt: deps.now() },
      }),
      deps.db.caseEvent.create({
        data: {
          caseId: action.caseId,
          type: "ACTION_FAILED",
          payload: json({ actionId: action.id, kind: action.kind, error }),
        },
      }),
      deps.db.notification.create({
        data: {
          caseId: action.caseId,
          kind: "ACTION_FAILED",
          level: "warning",
          message: `${action.case.paypalDisputeId}: your message to the buyer was not delivered (${error.message})`,
        },
      }),
    ]);
    return { status: "failed", actionId: action.id, error: error.message };
  }
}
