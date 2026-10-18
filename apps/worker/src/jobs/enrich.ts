import type { DisputedTransaction } from "@rebuttal/core";
import { isRetryable, type Capture, type Order } from "@rebuttal/paypal";
import { json } from "../case-row.js";
import { PermanentJobError, type Deps } from "../deps.js";
import { buildTransactionContext } from "../mapping.js";
import { QUEUES } from "../queues.js";

/**
 * case.enrich: the dispute's seller_transaction_id is the capture id; the capture links to
 * the order (supplementary_data.related_ids.order_id), which has items, shipping and trackers.
 * Missing records are noted in `errors` rather than failing the job; transient errors retry.
 */
export async function enrichCase(deps: Deps, caseId: string): Promise<void> {
  const row = await deps.db.case.findUnique({ where: { id: caseId } });
  if (!row) throw new PermanentJobError(`Case ${caseId} not found`);

  const errors: string[] = [];
  const attempt = async <T>(what: string, fn: () => Promise<T>): Promise<T | null> => {
    try {
      return await fn();
    } catch (err) {
      if (isRetryable(err)) throw err;
      errors.push(`${what}: ${err instanceof Error ? err.message : String(err)}`);
      return null;
    }
  };

  const txns = row.disputedTransactions as unknown as DisputedTransaction[];
  const captureId = txns.find((t) => t.sellerTransactionId)?.sellerTransactionId;
  let capture: Capture | null = null;
  let order: Order | null = null;
  if (captureId)
    capture = await attempt(`capture ${captureId}`, () => deps.paypal.payments.getCapture(captureId));
  else errors.push("dispute has no seller_transaction_id");
  const orderId = capture?.supplementary_data?.related_ids?.order_id;
  if (orderId) order = await attempt(`order ${orderId}`, () => deps.paypal.orders.get(orderId));
  else if (capture) errors.push(`capture ${capture.id} has no related order id`);

  const ctx = buildTransactionContext(capture, order, errors, deps.now());
  await deps.db.$transaction([
    deps.db.case.update({
      where: { id: caseId },
      data: { transactionContext: json(ctx), ...(row.state === "NEW" ? { state: "GATHERING" } : {}) },
    }),
    deps.db.caseEvent.create({
      data: {
        caseId,
        type: "ENRICHED",
        payload: json({
          captureId: ctx.capture?.id ?? null,
          orderId: ctx.order?.id ?? null,
          trackingNumbers: ctx.order?.trackingNumbers.length ?? 0,
          errors,
        }),
      },
    }),
  ]);
  await deps.queue.send(QUEUES.caseGather, { caseId }, { singletonKey: caseId });
}
