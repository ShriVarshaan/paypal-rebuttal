import { DEFAULT_POLICY, type DecisionOption, type OfferType, type Policy } from "@rebuttal/core";
import {
  evAccept,
  evFight,
  labor,
  offerValue,
  optimizeOffer,
  riskPenalty,
  type DecisionCase,
} from "@rebuttal/decision";
import { allowedResponses } from "@rebuttal/core";
import { wins, type EvalCase } from "./schema.js";

/** Eval case → the DecisionCase the engine reads (the production code path). */
export function toDecisionCase(c: EvalCase): DecisionCase {
  return {
    paypalDisputeId: c.id,
    reason: c.dispute.reason,
    stage: c.dispute.stage,
    amount: { cents: c.dispute.amountCents, currency: c.dispute.currency },
    sellerResponseDueAt: c.dispute.dueAt,
    paypalCreatedAt: c.dispute.openedAt,
    disputedTransactions: [{ createdAt: c.dispute.paidAt }],
    transactionContext: null,
    allowedResponseOptions: c.dispute.allowedResponseOptions,
  };
}

/** Decisions are made a day after the dispute opens, well before the deadline override. */
export const decisionTime = (c: EvalCase): Date => new Date(Date.parse(c.dispute.openedAt) + 86_400_000);

export interface Choice {
  option: DecisionOption;
  offerType?: OfferType | null;
  offerAmountCents?: number | null;
}

/** What actually happens to the seller's money in this case's world, in cents vs. refunding. */
export function realizedValue(c: EvalCase, choice: Choice, policy: Policy = DEFAULT_POLICY): number {
  const e = policy.economics;
  const A = c.dispute.amountCents;
  const fight = wins(c)
    ? A - labor(e, e.fightMinutes)
    : -(e.lossFeeCents + riskPenalty(e)) - labor(e, e.fightMinutes);
  switch (choice.option) {
    case "FIGHT":
      return fight;
    case "ACCEPT":
      return evAccept(e);
    case "OFFER": {
      const type = choice.offerType ?? "REFUND";
      const refund = choice.offerAmountCents ?? 0;
      const accepted = type === "REFUND" ? refund / A >= c.world.buyerAcceptRatio : c.world.acceptsReturn;
      return accepted ? offerValue(A, refund, type, e) - labor(e, e.offerMinutes) : fight;
    }
  }
}

/**
 * Expected value of each option under the world's true p_win, with the offer optimized on
 * the policy's acceptance curve (the generator draws buyers from that same curve). The
 * argmax is the ex-ante correct decision: it doesn't peek at the realized outcome.
 */
export function trueValues(c: EvalCase, policy: Policy = DEFAULT_POLICY) {
  const dc = toDecisionCase(c);
  const e = policy.economics;
  const allowed = allowedResponses(dc.allowedResponseOptions, dc.stage);
  const digital =
    c.evidence.some((x) => x.data["kind"] === "access_log") ||
    c.evidence.some(
      (x) =>
        x.data["kind"] === "order" &&
        (x.data["items"] as { digital?: boolean }[] | undefined)?.every((i) => i.digital),
    );
  const offer = optimizeOffer({
    amountCents: c.dispute.amountCents,
    currency: c.dispute.currency,
    pWin: c.world.pWin,
    allowedTypes: allowed.offerTypes,
    digital,
    economics: e,
    offer: policy.offer,
    reason: c.dispute.reason,
  });
  const values: { option: DecisionOption; ev: number }[] = [];
  if (allowed.accept) values.push({ option: "ACCEPT", ev: evAccept(e) });
  if (offer) values.push({ option: "OFFER", ev: offer.evCents });
  values.push({ option: "FIGHT", ev: evFight(c.dispute.amountCents, c.world.pWin, e) });
  const best = [...values].sort((a, b) => b.ev - a.ev)[0]!;
  return { values, best, offer };
}

export function trueEvOf(c: EvalCase, option: DecisionOption, policy: Policy = DEFAULT_POLICY): number {
  const v = trueValues(c, policy).values.find((x) => x.option === option);
  return v?.ev ?? Number.NEGATIVE_INFINITY;
}
