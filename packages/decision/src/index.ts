// Owned by B (win model, EV, offer optimizer, policy engine). See docs/plan.md §3.
// Only `safeDefault` exists so far: the SLA scheduler (A) calls it at T-2h.
import type { Case, DecisionInput, EvidenceItem } from "@rebuttal/core";

export interface SafeDefaultInput {
  case: Pick<Case, "paypalDisputeId" | "reason" | "stage" | "amount">;
  evidence: Pick<EvidenceItem, "type" | "data">[];
}

/**
 * PLACEHOLDER until B's policy engine lands. Fights only when there is delivery proof
 * for a not-received claim; otherwise accepts, which avoids a missed-deadline loss
 * stacking a chargeback fee on top of the refund.
 */
export function safeDefault(input: SafeDefaultInput): DecisionInput {
  const delivered = input.evidence.some(
    (e) => e.type === "PROOF_OF_FULFILLMENT" && e.data["status"] === "delivered",
  );
  if (input.case.reason === "MERCHANDISE_OR_SERVICE_NOT_RECEIVED" && delivered) {
    return {
      option: "FIGHT",
      note: "Carrier tracking shows the order was delivered to the shipping address on file.",
      reason: "DEADLINE",
    };
  }
  return {
    option: "ACCEPT",
    note: "Accepting the claim to resolve the dispute before the response deadline.",
    reason: "DEADLINE",
  };
}
