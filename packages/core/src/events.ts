import { z } from "zod";

export const CaseEventType = z.enum([
  "CREATED",
  "STATUS_CHANGED",
  "STAGE_CHANGED",
  "DUE_DATE_CHANGED",
  "BUYER_MESSAGE",
  "OUTCOME",
  "ENRICHED",
  "EVIDENCE_GATHERED",
  "DECISION_EXECUTING",
  "ACTION_SUCCEEDED",
  "ACTION_FAILED",
  "SLA_REMINDER",
  "SLA_FORCED_DECISION",
  // Added by B (intelligence): triage, decisions, appeals.
  "TRIAGED",
  "DECISION_PROPOSED",
  "DECISION_SUPERSEDED",
  "APPEAL_DRAFTED",
]);
export type CaseEventType = z.infer<typeof CaseEventType>;
