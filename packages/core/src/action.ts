import { z } from "zod";
import type { DecisionOption } from "./decision.js";

export const ActionKind = z.enum([
  "PROVIDE_EVIDENCE",
  "MAKE_OFFER",
  "ACCEPT_CLAIM",
  "SEND_MESSAGE",
  "ACKNOWLEDGE_RETURN_ITEM",
  "APPEAL",
  "PROVIDE_SUPPORTING_INFO",
  "REFUND",
]);
export type ActionKind = z.infer<typeof ActionKind>;

export const ActionStatus = z.enum(["PENDING", "IN_FLIGHT", "SUCCEEDED", "FAILED"]);
export type ActionStatus = z.infer<typeof ActionStatus>;

export const ACTION_FOR_OPTION: Record<DecisionOption, ActionKind> = {
  FIGHT: "PROVIDE_EVIDENCE",
  OFFER: "MAKE_OFFER",
  ACCEPT: "ACCEPT_CLAIM",
};

/** Stable `PayPal-Request-Id` for a decision's write call, so every retry reuses it. */
export function idempotencyKey(caseId: string, decisionId: string, action: ActionKind): string {
  return `${caseId}:${decisionId}:${action}`;
}
