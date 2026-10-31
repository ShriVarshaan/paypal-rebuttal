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
  "DECISION_EDITED",
  "APPEAL_DRAFTED",
  // Added by C (product): evidence packs, seller decisions and buyer messages.
  "PACK_READY",
  "PACK_FAILED",
  "DECISION_APPROVED",
  "DECISION_REJECTED",
  "DECISION_OVERRIDDEN",
  "NARRATIVE_EDITED",
  "MESSAGE_SENT",
]);
export type CaseEventType = z.infer<typeof CaseEventType>;
